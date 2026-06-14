import path from 'path';
import { fileURLToPath } from 'url';
import { copyGroovyJar } from '../../scripts/lib/prepare-pkg.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

copyGroovyJar({
  root,
  candidates: [
    path.join(root, 'groovyExec.jar'),
    path.join(root, '..', 'groovyExec.jar'),
    process.env.GROOVY_JAR,
  ],
});
