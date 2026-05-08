type Snippet = { trig: string; body: string };
const toSnippetText = ({ trig, body }: Snippet) =>
    "snippet " + trig + "\n\t" + body.replace(/\r/g, "").replace(/\n/g, "\n\t");

export function registerJSSnippets(snippetManager: any) {
    const core: Snippet[] = [
        { trig: "log", body: "console.log(${1:msg});${0}" },
        { trig: "warn", body: "console.warn(${1:msg});${0}" },
        { trig: "err", body: "console.error(${1:err});${0}" },
        { trig: "fn", body: "function ${1:name}(${2:args}) {\n\t${3}\n}\n${0}" },
        { trig: "afn", body: "const ${1:name} = (${2:args}) => {\n\t${3}\n};${0}" },
        { trig: "class", body: "class ${1:MyClass} {\n\tconstructor(${2:args}) { ${3} }\n\t${4:method()} { ${5} }\n}\n${0}" },
        { trig: "if", body: "if (${1:cond}) {\n\t${2}\n}${0}" },
        { trig: "ife", body: "if (${1:cond}) {\n\t${2}\n} else {\n\t${3}\n}${0}" },
        { trig: "switch", body: "switch (${1:x}) {\n\tcase ${2:a}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n}${0}" },
        { trig: "fori", body: "for (let ${1:i}=0; ${1:i}<${2:n}; ${1:i}++) {\n\t${3}\n}${0}" },
        { trig: "forof", body: "for (const ${1:x} of ${2:iterable}) {\n\t${3}\n}${0}" },
        { trig: "forin", body: "for (const ${1:k} in ${2:obj}) {\n\t${3}\n}${0}" },
        { trig: "while", body: "while (${1:cond}) {\n\t${2}\n}${0}" },
        { trig: "try", body: "try {\n\t${1}\n} catch (${2:e}) {\n\t${3}\n} finally {\n\t${4}\n}${0}" },
        { trig: "prom", body: "return new Promise((resolve, reject) => {\n\t${1}\n});${0}" },
        { trig: "await", body: "const ${1:res} = await ${2:promise};${0}" },
        { trig: "async", body: "async function ${1:name}(${2:args}) {\n\t${3}\n}\n${0}" },
        { trig: "im", body: "import ${1:mod} from '${2:pkg}';${0}" },
        { trig: "imn", body: "import { ${1:name} } from '${2:pkg}';${0}" },
        { trig: "ex", body: "export default ${1:thing};${0}" },
        { trig: "exp", body: "export { ${1:name} };${0}" },
        { trig: "dob", body: "const ${1:o} = { ${2:key}: ${3:value} };${0}" },
        { trig: "arr", body: "const ${1:a} = [${2:1,2,3}];${0}" },
        { trig: "jsonp", body: "const ${1:obj} = JSON.parse(${2:jsonString});${0}" },
        { trig: "jsons", body: "const ${1:json} = JSON.stringify(${2:obj}, null, 2);${0}" },
        { trig: "debounce", body: "const ${1:debounce} = (fn, wait=300) => { let t; return (...args) => { clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; };${0}" },
        { trig: "throttle", body: "const ${1:throttle} = (fn, wait=300) => { let last=0; return (...args)=>{ const now=Date.now(); if(now-last>wait){ last=now; fn(...args);} }; };${0}" },
        { trig: "fetch", body: "const res = await fetch('${1:/api}', { method: '${2:GET}', headers: { 'Content-Type': 'application/json' }, body: ${3:null} });\nconst data = await res.json();${0}" },
        { trig: "timer", body: "setTimeout(()=>{ ${1} }, ${2:1000});${0}" },
        { trig: "interval", body: "const id=setInterval(()=>{ ${1} }, ${2:1000});${0}" },
        { trig: "clearint", body: "clearInterval(${1:id});${0}" },
        { trig: "regex", body: "const re = /${1:pattern}/${2:g};\nconst m = ${3:str}.match(re);${0}" },
        { trig: "map", body: "const ${1:r} = ${2:arr}.map(${3:x} => ${4});${0}" },
        { trig: "filter", body: "const ${1:r} = ${2:arr}.filter(${3:x} => ${4});${0}" },
        { trig: "reduce", body: "const ${1:r} = ${2:arr}.reduce((acc, x) => ${3:acc + x}, ${4:0});${0}" },
        { trig: "find", body: "const ${1:r} = ${2:arr}.find(x => ${3});${0}" },
        { trig: "some", body: "const ${1:r} = ${2:arr}.some(x => ${3});${0}" },
        { trig: "every", body: "const ${1:r} = ${2:arr}.every(x => ${3});${0}" },
        { trig: "set", body: "const ${1:s} = new Set(${2:iterable});${0}" },
        { trig: "mapobj", body: "const ${1:m} = new Map(${2:entries});${0}" },
        { trig: "date", body: "const ${1:now} = new Date();${0}" },
        { trig: "uuid", body: "const ${1:id} = crypto.randomUUID();${0}" },
        { trig: "tryjson", body: "let ${1:obj}; try { ${1:obj}=JSON.parse(${2:s}); } catch(e){ console.error(e);} ${0}" },
    ];

    // Array helpers
    const arrOps = [
        ["flat", "flat(${1:1})"],
        ["flatMap", "flatMap(${1:x} => ${2})"],
        ["slice", "slice(${1:begin}, ${2:end})"],
        ["splice", "splice(${1:start}, ${2:deleteCount})"],
        ["fill", "fill(${1:value}, ${2:start}, ${3:end})"],
        ["sort", "sort((a,b)=>${1:a-b})"],
        ["reverse", "reverse()"],
        ["concat", "concat(${1:other})"],
        ["includes", "includes(${1:value})"],
        ["indexOf", "indexOf(${1:value})"],
        ["join", "join('${1:,}')"],
        ["from", "Array.from(${1:iterable})"],
        ["of", "Array.of(${1:items})"],
    ] as const;

    const arr: Snippet[] = arrOps.map(([name, expr]) => ({
        trig: "a_" + name,
        body: "const ${1:r} = ${2:arr}.${expr};${0}",
    }));

    // Object utils
    const objOps = [
        ["assign", "Object.assign(${1:target}, ${2:src})"],
        ["keys", "Object.keys(${1:obj})"],
        ["values", "Object.values(${1:obj})"],
        ["entries", "Object.entries(${1:obj})"],
        ["fromEntries", "Object.fromEntries(${1:iter})"],
        ["hasOwn", "Object.hasOwn(${1:obj}, '${2:key}')"],
        ["freeze", "Object.freeze(${1:obj})"],
        ["seal", "Object.seal(${1:obj})"],
    ] as const;

    const obj: Snippet[] = objOps.map(([name, expr]) => ({
        trig: "o_" + name,
        body: "const ${1:r} = ${expr};${0}",
    }));

    // DOM
    const dom: Snippet[] = [
        { trig: "qs", body: "const ${1:el} = document.querySelector('${2:selector}');${0}" },
        { trig: "qsa", body: "const ${1:els} = document.querySelectorAll('${2:selector}');${0}" },
        { trig: "addevent", body: "${1:el}.addEventListener('${2:event}', e => { ${3} });${0}" },
        { trig: "create", body: "const ${1:div} = document.createElement('${2:div}');${0}" },
        { trig: "append", body: "${1:parent}.appendChild(${2:child});${0}" },
        { trig: "classlist", body: "${1:el}.classList.add('${2:cls}');${0}" },
    ];

    // Node.js (ESM)
    const node: Snippet[] = [
        {
            trig: "reqhttp",
            body:
                "import { createServer } from 'node:http';\n" +
                "createServer((req, res) => { res.end('${1:ok}'); }).listen(${2:3000});${0}",
        },
        {
            trig: "pathjoin",
            body:
                "import path from 'node:path';\nimport { fileURLToPath } from 'node:url';\n" +
                "const __filename = fileURLToPath(import.meta.url);\nconst __dirname = path.dirname(__filename);\n" +
                "const p = path.join(${1:__dirname}, '${2:file}');${0}",
        },
        {
            trig: "env",
            body: "const ${1:val} = process.env.${2:NAME};${0}",
        },
        {
            trig: "nodefsr",
            body:
                "import { readFileSync } from 'node:fs';\n" +
                "const txt = readFileSync('${1:path}', 'utf8');${0}",
        },
        {
            trig: "nodefsw",
            body:
                "import { writeFileSync } from 'node:fs';\n" +
                "writeFileSync('${1:path}', ${2:data});${0}",
        },
    ];

    // Playwright (ESM)
    const pw: Snippet[] = [
        { trig: "pw-import", body: "import { chromium, firefox, webkit, devices } from 'playwright';${0}" },

        { trig: "pw-launch", body: "const browser = await ${1:chromium}.launch({ headless: ${2:true}, slowMo: ${3:0} });${0}" },
        { trig: "pw-connect", body: "const browser = await ${1:chromium}.connectOverCDP('${2:ws://localhost:9222}');${0}" },
        { trig: "pw-context", body: "const context = await browser.newContext({ viewport: { width: ${1:1280}, height: ${2:800} }, userAgent: '${3:MyAgent/1.0}' });${0}" },
        { trig: "pw-context-device", body: "const iPhone = devices['${1:iPhone 13}'];\nconst context = await browser.newContext({ ...iPhone });${0}" },
        { trig: "pw-context-proxy", body: "const context = await browser.newContext({ proxy: { server: '${1:http://127.0.0.1:8080}' } });${0}" },
        { trig: "pw-context-auth", body: "const context = await browser.newContext({ httpCredentials: { username: '${1:user}', password: '${2:pass}' } });${0}" },
        { trig: "pw-context-cookies", body: "await context.addCookies([{ name: '${1:name}', value: '${2:value}', domain: '${3:example.com}', path: '/', httpOnly: ${4:true} }]);${0}" },
        { trig: "pw-context-storage", body: "await context.storageState({ path: '${1:state.json}' });${0}" },

        { trig: "pw-page", body: "const page = await context.newPage();${0}" },
        { trig: "pw-goto", body: "await page.goto('${1:https://example.com}', { waitUntil: '${2:load}', timeout: ${3:30000} });${0}" },
        { trig: "pw-waitselector", body: "await page.waitForSelector('${1:css-or-text}', { state: '${2:visible}', timeout: ${3:30000} });${0}" },
        { trig: "pw-waitnav", body: "await page.waitForNavigation({ url: '${1:*/dashboard}', waitUntil: '${2:networkidle}' });${0}" },

        { trig: "pw-click", body: "await page.click('${1:selector}', { button: '${2:left}', clickCount: ${3:1}, delay: ${4:0} });${0}" },
        { trig: "pw-fill", body: "await page.fill('${1:input}', '${2:texte}');${0}" },
        { trig: "pw-type", body: "await page.type('${1:input}', '${2:texte}', { delay: ${3:50} });${0}" },
        { trig: "pw-press", body: "await page.press('${1:selector}', '${2:Enter}');${0}" },
        { trig: "pw-select", body: "await page.selectOption('${1:select}', { value: '${2:valeur}' });${0}" },
        { trig: "pw-check", body: "await page.check('${1:#agree}');${0}" },
        { trig: "pw-uncheck", body: "await page.uncheck('${1:#agree}');${0}" },
        { trig: "pw-hover", body: "await page.hover('${1:selector}');${0}" },

        { trig: "pw-locator", body: "const el = page.locator('${1:selector}');\nawait el.${2:click}();${0}" },
        { trig: "pw-eval", body: "const result = await page.evaluate(() => { return ${1:document.title}; });${0}" },
        { trig: "pw-eval-arg", body: "const result = await page.evaluate((data) => { return ${2:document.querySelector(data.sel)?.textContent}; }, { sel: '${1:#id}' });${0}" },

        { trig: "pw-waitresponse", body: "const resp = await page.waitForResponse(r => r.url().includes('${1:/api/}') && r.status() === ${2:200});${0}" },
        { trig: "pw-routestub", body: "await page.route('${1:**/track*}', route => route.abort());${0}" },
        { trig: "pw-route-mock", body: "await page.route('${1:**/api/items}', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(${2:{ items: [] }}) }));${0}" },

        { trig: "pw-screenshot", body: "await page.screenshot({ path: '${1:screenshot.png}', fullPage: ${2:true} });${0}" },
        { trig: "pw-pdf", body: "await page.emulateMedia({ media: 'screen' });\nawait page.pdf({ path: '${1:page.pdf}', format: '${2:A4}', printBackground: ${3:true} });${0}" },

        { trig: "pw-download", body: "const [ download ] = await Promise.all([\n  page.waitForEvent('download'),\n  page.click('${1:selector}')\n]);\nawait download.saveAs('${2:file.zip}');${0}" },
        { trig: "pw-upload", body: "const [ chooser ] = await Promise.all([\n  page.waitForEvent('filechooser'),\n  page.click('${1:input[type=file]}')\n]);\nawait chooser.setFiles('${2:path/to/file}');${0}" },

        { trig: "pw-keyboard", body: "await page.keyboard.type('${1:Hello}', { delay: ${2:50} });\nawait page.keyboard.press('${3:ControlOrMeta}+${4:A}');${0}" },
        { trig: "pw-mouse", body: "await page.mouse.move(${1:100}, ${2:200});\nawait page.mouse.click(${3:120}, ${4:220});${0}" },

        { trig: "pw-console-listen", body: "page.on('console', msg => console.log('[console]', msg.type(), msg.text()));${0}" },
        { trig: "pw-request-api", body: "const res = await context.request.get('${1:https://api.example.com/data}', { headers: { '${2:Authorization}': '${3:Bearer token}' } });\nconst json = await res.json();\nconsole.log(json);${0}" },
        { trig: "pw-post-api", body: "const res = await context.request.post('${1:https://api.example.com/items}', { data: ${2:{ name: 'Item' }} });\nconsole.log(await res.json());${0}" },

        { trig: "pw-newtab", body: "const [ newPage ] = await Promise.all([\n  context.waitForEvent('page'),\n  page.click('${1:a[target=_blank]}')\n]);\nawait newPage.waitForLoadState('${2:domcontentloaded}');${0}" },

        { trig: "pw-assert-url", body: "if (!page.url().includes('${1:expected}')) throw new Error('URL inattendue: ' + page.url());${0}" },

        { trig: "pw-close", body: "await page.close();\nawait context.close();\nawait browser.close();${0}" },

        {
            trig: "pw-test",
            body:
                "import { test, expect } from '@playwright/test';\n\n" +
                "test('${1:scenario}', async ({ page }) => {\n" +
                "  await page.goto('${2:https://example.com}');\n" +
                "  await page.click('${3:button}');\n" +
                "  await expect(page.locator('${4:h1}')).toHaveText('${5:Bienvenue}');\n" +
                "});${0}",
        },

        {
            trig: "pw-base",
            body:
                "import { chromium } from 'playwright';\n" +
                "const browser = await chromium.launch({ headless: ${1:true} });\n" +
                "const context = await browser.newContext();\n" +
                "const page = await context.newPage();\n" +
                "await page.goto('${2:https://example.com}');\n" +
                "// ...\n" +
                "await browser.close();${0}",
        },
        // Playwright: utiliser Edge (channel)
        { trig: "pw-launch-edge", body: "const browser = await chromium.launch({ channel: 'msedge', headless: ${1:true}, slowMo: ${2:0} });${0}" },

        // Playwright: utiliser Edge via chemin explicite
        { trig: "pw-launch-edge-path", body: "const browser = await chromium.launch({ executablePath: 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe', headless: ${1:true}, slowMo: ${2:0} });${0}" },

        // Variante base directement en Edge (channel)
        {
            trig: "pw-base-edge", body:
                "import { chromium } from 'playwright';\n" +
                "const browser = await chromium.launch({ channel: 'msedge', headless: ${1:true} });\n" +
                "const context = await browser.newContext();\n" +
                "const page = await context.newPage();\n" +
                "await page.goto('${2:https://example.com}');\n" +
                "await browser.close();${0}"
        },

        // Config Playwright: Edge par défaut pour @playwright/test
        {
            trig: "pw-config-edge", body:
                "// playwright.config.ts (ESM)\n" +
                "import { defineConfig } from '@playwright/test';\n" +
                "export default defineConfig({\n" +
                "  use: {\n" +
                "    channel: 'msedge', // Utilise Edge installé\n" +
                "    headless: ${1:true}\n" +
                "  }\n" +
                "});\n${0}"
        },

        // Config Playwright: Edge via chemin (si tu veux forcer ce binaire précis)
        {
            trig: "pw-config-edge-path", body:
                "// playwright.config.ts (ESM)\n" +
                "import { defineConfig } from '@playwright/test';\n" +
                "export default defineConfig({\n" +
                "  use: {\n" +
                "    browserName: 'chromium',\n" +
                "    executablePath: 'C:\\\\Program Files (x86)\\\\Microsoft\\\\Edge\\\\Application\\\\msedge.exe',\n" +
                "    headless: ${1:true}\n" +
                "  }\n" +
                "});\n${0}"
        }

    ];
    const promiseSnippets: Snippet[] = [
        // Création d'une promesse
        { trig: "prom-new", body: "const ${1:promise} = new Promise((resolve, reject) => {\n  try {\n    ${2:// ... travail}\n    resolve(${3:value});\n  } catch (e) {\n    reject(e);\n  }\n});${0}" },
      
        // Promisifier une API callback
        { trig: "prom-wrap", body: "const ${1:fnAsync} = (...args) => new Promise((resolve, reject) => {\n  ${2:fs.readFile}(args[0], (err, data) => err ? reject(err) : resolve(data));\n});${0}" },
      
        // Map async en parallèle + await (résultats dans l'ordre d'entrée)
        { trig: "await-map", body: "const ${1:results} = await Promise.all(${2:items}.map(async (${3:x}) => {\n  ${4:// ...}\n  return ${5:x};\n}));${0}" },
      
        // Map async avec parallélisme limité (par chunks)
        { trig: "await-map-concurrency", body: "const ${1:out} = [];\nfor (let i = 0; i < ${2:items}.length; i += ${3:5}) {\n  const chunk = ${2:items}.slice(i, i + ${3:5});\n  const part = await Promise.all(chunk.map(async (${4:x}) => { ${5} return ${6:x}; }));\n  ${1:out}.push(...part);\n}\n${0}" },
      
        // Promise.all basique
        { trig: "pall", body: "const [${1:a}, ${2:b}] = await Promise.all([${3:p1}, ${4:p2}]);${0}" },
      
        // allSettled (succès + erreurs)
        { trig: "pallsettled", body: "const ${1:settled} = await Promise.allSettled([${2:p1}, ${3:p2}]);${0}" },
      
        // race / any
        { trig: "prace", body: "const ${1:first} = await Promise.race([${2:p1}, ${3:p2}]);${0}" },
        { trig: "pany", body: "const ${1:any} = await Promise.any([${2:p1}, ${3:p2}]);${0}" },
      
        // Séquentiel : for..of + await
        { trig: "pseq-forof", body: "for (const ${1:item} of ${2:items}) {\n  const ${3:res} = await ${4:fn}(${1:item});\n  ${5}\n}\n${0}" },
      
        // Séquentiel : chaînage avec reduce
        { trig: "pseq-reduce", body: "await ${1:items}.reduce(async (prev, ${2:item}) => {\n  await prev;\n  ${3:await fn(${2:item})}\n}, Promise.resolve());${0}" },
      
        // try/catch autour d'une promesse
        { trig: "ptrycatch", body: "try {\n  const ${1:res} = await ${2:promise};\n  ${3}\n} catch (${4:e}) {\n  ${5:console.error(${4:e})}\n}\n${0}" },
      
        // Timeout utilitaire
        { trig: "ptimeout", body: "const ${1:withTimeout} = (p, ms = ${2:5000}) => Promise.race([\n  p,\n  new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), ms))\n]);${0}" }
      ];
      
    let all: Snippet[] = [...core, ...arr, ...obj, ...dom, ...node, ...pw, ...promiseSnippets];

    const file = all.map(toSnippetText).join("\n");
    snippetManager.register(snippetManager.parseSnippetFile(file), "javascript");
}
