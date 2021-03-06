/* eslint-disable @typescript-eslint/no-var-requires, prefer-destructuring  */
import fs, { readFileSync } from "fs";
import { join, relative, dirname, basename, extname, sep } from "path";
import frontMatter from "front-matter";
import globby from "globby";
import startCase from "lodash.startcase";

/** @ignore */
const transformLinks = require("transform-markdown-links");

/** @ignore */
const transform = require("doctoc/lib/transform");

/** @ignore */
const readFile = fs.promises.readFile;

/** @ignore */
export function gitHubLink(val: string): string {
  /* istanbul ignore next */
  const value = val || "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s/g, "-")
    .replace(/-+$/, "");
}

/**  @ignore */
interface File {
  path: string;
  [key: string]: any;
}

/**
 * Concat function options.
 */
export interface ConcatOptions {
  /**
   * A global title to add at the beginning of the output.
   */
  title?: string;
  /**
   * Whether to add a table of contents.
   */
  toc?: boolean;
  /**
   * Limit TOC entries to headings only up to the specified level.
   */
  tocLevel?: number;
  /**
   * Glob patterns to exclude in `dir`.
   */
  ignore?: string | string[];
  /**
   * Glob patterns to look for in `dir`.  Default: "** /*.md"
   */
  include?: string | string[];
  /**
   * Whether to decrease levels of all titles in markdown file to set them below file and directory title levels.
   */
  decreaseTitleLevels?: boolean;
  /**
   * Level to start file and directory levels.
   */
  startTitleLevelAt?: number;
  /**
   * String to be used to join concatenated files.
   */
  joinString?: string;
  /**
   * Key name to get title in `FrontMatter` meta data in markdown headers.
   */
  titleKey?: string;
  /**
   * Whether to use file names as titles.
   */
  fileNameAsTitle?: boolean;
  /**
   * Whether to use directory names as titles.
   */
  dirNameAsTitle?: boolean;
}

/**
 * Makes given input array and returns it.
 *
 * @param input to construct array from
 * @returns created array.
 * @ignore
 */
function arrify<T>(input: T | T[]): T[] {
  return Array.isArray(input) ? input : [input];
}

/**  @ignore */
class MarkDownConcatenator {
  private dir: string;
  private title?: string;
  private toc: boolean;
  private ignore: string[];
  private include: string[];
  private decreaseTitleLevels: boolean;
  private startTitleLevelAt: number;
  private titleKey?: string;
  private fileNameAsTitle: boolean;
  private dirNameAsTitle: boolean;
  private joinString: string;
  private visitedDirs: Set<string> = new Set();
  private fileTitleIndex: Map<string, { title: string; level: number; md: string }> = new Map();
  private tocLevel: number;

  public constructor(
    dir: string,
    {
      title,
      toc = false,
      tocLevel = 3,
      ignore = [],
      include = [],
      decreaseTitleLevels = false,
      startTitleLevelAt = 1,
      joinString,
      titleKey,
      dirNameAsTitle = false,
      fileNameAsTitle = false,
    }: ConcatOptions = {} as any
  ) {
    this.dir = dir;
    this.title = title;
    this.toc = toc;
    this.tocLevel = tocLevel;
    this.ignore = arrify(ignore);
    this.include = include.length ? arrify(include) : ["**/*.md"];
    this.decreaseTitleLevels = decreaseTitleLevels;
    this.startTitleLevelAt = startTitleLevelAt;
    this.joinString = joinString ? `\n${joinString}\n` : "\n";
    this.titleKey = titleKey;
    this.dirNameAsTitle = dirNameAsTitle;
    this.fileNameAsTitle = fileNameAsTitle;
  }

  private decreaseTitleLevelsBy(body: string, level: number): string {
    return !this.decreaseTitleLevels || level <= 0 ? body : body.replace(/(^#+)/gm, `$1${"#".repeat(level)}`);
  }

  private async getFileNames(): Promise<string[]> {
    const paths = await globby(this.include, {
      cwd: this.dir,
      expandDirectories: ["**/*.md"],
      ignore: this.ignore,
    });
    return paths.map(path => join(this.dir, path));
  }

  private getFileNamesSync(): string[] {
    const paths = globby.sync(this.include, {
      cwd: this.dir,
      expandDirectories: ["**/*.md"],
      ignore: this.ignore,
    });
    return paths.map(path => join(this.dir, path));
  }

  private async getFileDetails(): Promise<File[]> {
    const fileNames = await this.getFileNames();
    return Promise.all(
      fileNames.map(async fileName => ({ path: fileName, ...frontMatter(await readFile(fileName, { encoding: "utf8" })) }))
    );
  }

  private getFileDetailsSync(): File[] {
    const fileNames = this.getFileNamesSync();

    return fileNames.map(fileName => ({ path: fileName, ...frontMatter(readFileSync(fileName, { encoding: "utf8" })) }));
  }

  private getDirParts(file: File): string[] {
    return this.dir === dirname(file.path) ? [] : relative(this.dir, dirname(file.path)).split(sep);
  }

  private addTitle(file: File): void {
    let titleMd = "";
    let fileTitle;
    const titleSuffix = "\n\n";
    let level = this.startTitleLevelAt - 1;

    if (this.dirNameAsTitle) {
      let currentDir = "";
      const dirParts = this.getDirParts(file);
      dirParts.forEach(part => {
        currentDir += currentDir ? sep + part : part;
        level += 1;
        if (!this.visitedDirs.has(currentDir)) {
          const dirTitlePrefix = "#".repeat(level); // #, ##, ### ...etc.
          const dirTitle = startCase(part);
          titleMd += `${dirTitlePrefix} ${dirTitle}${titleSuffix}`;
          this.visitedDirs.add(currentDir);
          this.fileTitleIndex.set(join(this.dir, currentDir), { title: dirTitle, md: titleMd, level });
        }
      });
    }

    const titleFromMeta: string = this.titleKey && file.attributes && file.attributes[this.titleKey];
    const titleFromFileName = `${startCase(basename(file.path, extname(file.path)))}`;

    if (titleFromMeta || this.fileNameAsTitle) {
      fileTitle = titleFromMeta || titleFromFileName;
      level += 1;
      const titlePrefix = "#".repeat(level); // #, ##, ### ...etc.
      titleMd += `${titlePrefix} ${fileTitle}${titleSuffix}`;
    } else {
      fileTitle = gitHubLink(relative(this.dir, file.path));
      titleMd += `\n<a name="${fileTitle}"></a>\n\n`; // Provide an anchor to point links to this location. (For existing links pointing to file.)
    }

    this.fileTitleIndex.set(file.path, { title: fileTitle, md: titleMd, level });
  }

  private getTitle(filePath: string): { title: string; level: number; md: string } {
    const title = this.fileTitleIndex.get(filePath);
    /* istanbul ignore next */
    if (!title) {
      throw new Error(`Cannot get title for ${filePath}`);
    }
    return title;
  }

  private addGlobalTitleAndToc(content: string): string {
    if (!this.toc) {
      if (this.title) {
        return `# ${this.title}\n${content}`;
      }
      return content;
    }

    const TOC_TAG = "<!-- START doctoc -->\n<!-- END doctoc -->";
    let result = content;

    if (!result.includes(TOC_TAG)) {
      result = `${TOC_TAG}\n\n${result}`;
    }
    if (this.title) {
      result = `# ${this.title}\n\n${result}`;
    }
    const docTocResult = transform(result, "github.com", this.tocLevel, undefined, true);
    if (docTocResult.transformed) {
      result = docTocResult.data;
    }
    return result;
  }

  private modifyLinks(file: File): string {
    return transformLinks(file.body, (link: string): string => {
      if (link.startsWith("http")) {
        return link;
      }

      // [ModifyCondition](../interfaces/modifycondition.md)    - Link to file.
      // [FileFormat](../README.md#fileformat)                  - Section in relative file.
      // [saveSync](datafile.md#savesync)                       - Link in same file
      // <a name="there_you_go"></a>Take me there

      const absoluteTargetPath = join(dirname(file.path), link);
      const hashPosition = absoluteTargetPath.indexOf("#");
      const hash = hashPosition > -1 ? absoluteTargetPath.slice(hashPosition) : "";
      const targetFile = hashPosition > -1 ? absoluteTargetPath.slice(0, hashPosition) : absoluteTargetPath;
      try {
        const newLink = hash || `#${gitHubLink(this.getTitle(targetFile).title)}`;
        return newLink;
      } catch (e) {
        /* istanbul ignore next */
        return "";
      }

      // console.log(link, newLink, targetFile, hash);
    });
  }

  private concatFiles(files: File[]): string {
    files.forEach(file => {
      this.addTitle(file);
      const { level, md } = this.getTitle(file.path);
      const body = this.decreaseTitleLevelsBy(file.body, level);
      file.body = `${md}${body}`; // eslint-disable-line no-param-reassign
    });

    // 2nd pass loop is necessary, because all titles has to be processed.
    files.forEach(file => {
      file.body = this.modifyLinks(file); // eslint-disable-line no-param-reassign
    });

    const result = files.map(file => file.body).join(this.joinString);
    return this.addGlobalTitleAndToc(result);
  }

  public async concat(): Promise<string> {
    const files = await this.getFileDetails();
    return this.concatFiles(files);
  }

  public concatSync(): string {
    const files = this.getFileDetailsSync();
    return this.concatFiles(files);
  }
}

/**
 * Scans and concatenates all markdown files in given directory.
 *
 * @param dir is the directory to scan markdown files in.
 * @param options are several parameters to modify concatenation behaviour.
 * @returns concatenated contents of markdown files.
 * @example
 * import concatMd, { concatMdSync } from "concat-md"
 */
export function concatMdSync(dir: string, options?: ConcatOptions): string {
  const markDownConcatenator = new MarkDownConcatenator(dir, options);
  return markDownConcatenator.concatSync();
}

/**
 * Scans and concatenates all markdown files in given directory.
 *
 * @param dir is the directory to scan markdown files in.
 * @param options are several parameters to modify concatenation behaviour.
 * @returns concatenated contents of markdown files.
 * @example
 * import concatMd, { concatMdSync } from "concat-md"
 */
export default async function concatMd(dir: string, options?: ConcatOptions): Promise<string> {
  const markDownConcatenator = new MarkDownConcatenator(dir, options);
  return markDownConcatenator.concat();
}
