import { readable } from './nav';
import { ruleCatalogEntry } from '../contract/ruleCatalog';
export const issueTitle = (code: string) => ruleCatalogEntry(code)?.title ?? readable(code);
