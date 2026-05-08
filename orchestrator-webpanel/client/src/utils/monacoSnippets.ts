import type { languages } from 'monaco-editor';

export interface MonacoSnippet {
  label: string;
  insertText: string;
  documentation?: string;
}

// Convert Ace-style snippet body to Monaco snippet format
// Ace uses ${1:placeholder} which is same as Monaco, so mostly compatible
function convertSnippetBody(body: string): string {
  // Ace and Monaco both use ${n:placeholder} syntax, so most conversions are direct
  // Just ensure proper escaping
  return body;
}

// ============ JavaScript Snippets ============
export const jsSnippets: MonacoSnippet[] = [
  { label: "log", insertText: "console.log(${1:msg});", documentation: "Console log" },
  { label: "warn", insertText: "console.warn(${1:msg});", documentation: "Console warn" },
  { label: "err", insertText: "console.error(${1:err});", documentation: "Console error" },
  { label: "fn", insertText: "function ${1:name}(${2:args}) {\n\t${3}\n}", documentation: "Function declaration" },
  { label: "afn", insertText: "const ${1:name} = (${2:args}) => {\n\t${3}\n};", documentation: "Arrow function" },
  { label: "class", insertText: "class ${1:MyClass} {\n\tconstructor(${2:args}) { ${3} }\n\t${4:method}() { ${5} }\n}", documentation: "Class declaration" },
  { label: "if", insertText: "if (${1:condition}) {\n\t${2}\n}", documentation: "If statement" },
  { label: "ife", insertText: "if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}", documentation: "If-else statement" },
  { label: "switch", insertText: "switch (${1:x}) {\n\tcase ${2:a}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n}", documentation: "Switch statement" },
  { label: "fori", insertText: "for (let ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}", documentation: "For loop" },
  { label: "forof", insertText: "for (const ${1:x} of ${2:iterable}) {\n\t${3}\n}", documentation: "For-of loop" },
  { label: "forin", insertText: "for (const ${1:k} in ${2:obj}) {\n\t${3}\n}", documentation: "For-in loop" },
  { label: "while", insertText: "while (${1:condition}) {\n\t${2}\n}", documentation: "While loop" },
  { label: "try", insertText: "try {\n\t${1}\n} catch (${2:e}) {\n\t${3}\n} finally {\n\t${4}\n}", documentation: "Try-catch-finally" },
  { label: "prom", insertText: "return new Promise((resolve, reject) => {\n\t${1}\n});", documentation: "Promise" },
  { label: "await", insertText: "const ${1:res} = await ${2:promise};", documentation: "Await" },
  { label: "async", insertText: "async function ${1:name}(${2:args}) {\n\t${3}\n}", documentation: "Async function" },
  { label: "im", insertText: "import ${1:mod} from '${2:pkg}';", documentation: "Import default" },
  { label: "imn", insertText: "import { ${1:name} } from '${2:pkg}';", documentation: "Import named" },
  { label: "ex", insertText: "export default ${1:thing};", documentation: "Export default" },
  { label: "exp", insertText: "export { ${1:name} };", documentation: "Export named" },
  { label: "dob", insertText: "const ${1:o} = { ${2:key}: ${3:value} };", documentation: "Object literal" },
  { label: "arr", insertText: "const ${1:a} = [${2:1, 2, 3}];", documentation: "Array literal" },
  { label: "jsonp", insertText: "const ${1:obj} = JSON.parse(${2:jsonString});", documentation: "JSON parse" },
  { label: "jsons", insertText: "const ${1:json} = JSON.stringify(${2:obj}, null, 2);", documentation: "JSON stringify" },
  { label: "fetch", insertText: "const res = await fetch('${1:/api}', { method: '${2:GET}', headers: { 'Content-Type': 'application/json' }, body: ${3:null} });\nconst data = await res.json();", documentation: "Fetch API" },
  { label: "timer", insertText: "setTimeout(() => { ${1} }, ${2:1000});", documentation: "setTimeout" },
  { label: "interval", insertText: "const id = setInterval(() => { ${1} }, ${2:1000});", documentation: "setInterval" },
  { label: "map", insertText: "const ${1:r} = ${2:arr}.map(${3:x} => ${4});", documentation: "Array map" },
  { label: "filter", insertText: "const ${1:r} = ${2:arr}.filter(${3:x} => ${4});", documentation: "Array filter" },
  { label: "reduce", insertText: "const ${1:r} = ${2:arr}.reduce((acc, x) => ${3:acc + x}, ${4:0});", documentation: "Array reduce" },
  { label: "find", insertText: "const ${1:r} = ${2:arr}.find(x => ${3});", documentation: "Array find" },
  { label: "qs", insertText: "const ${1:el} = document.querySelector('${2:selector}');", documentation: "querySelector" },
  { label: "qsa", insertText: "const ${1:els} = document.querySelectorAll('${2:selector}');", documentation: "querySelectorAll" },
  { label: "addevent", insertText: "${1:el}.addEventListener('${2:event}', e => { ${3} });", documentation: "addEventListener" },
  // Playwright snippets
  { label: "pw-import", insertText: "import { chromium, firefox, webkit, devices } from 'playwright';", documentation: "Playwright import" },
  { label: "pw-launch", insertText: "const browser = await ${1:chromium}.launch({ headless: ${2:true}, slowMo: ${3:0} });", documentation: "Launch browser" },
  { label: "pw-context", insertText: "const context = await browser.newContext({ viewport: { width: ${1:1280}, height: ${2:800} } });", documentation: "New context" },
  { label: "pw-page", insertText: "const page = await context.newPage();", documentation: "New page" },
  { label: "pw-goto", insertText: "await page.goto('${1:https://example.com}', { waitUntil: '${2:load}', timeout: ${3:30000} });", documentation: "Navigate to URL" },
  { label: "pw-click", insertText: "await page.click('${1:selector}');", documentation: "Click element" },
  { label: "pw-fill", insertText: "await page.fill('${1:input}', '${2:text}');", documentation: "Fill input" },
  { label: "pw-screenshot", insertText: "await page.screenshot({ path: '${1:screenshot.png}', fullPage: ${2:true} });", documentation: "Take screenshot" },
  { label: "pw-close", insertText: "await page.close();\nawait context.close();\nawait browser.close();", documentation: "Close all" },
  { label: "pw-base", insertText: "import { chromium } from 'playwright';\nconst browser = await chromium.launch({ headless: ${1:true} });\nconst context = await browser.newContext();\nconst page = await context.newPage();\nawait page.goto('${2:https://example.com}');\n// ...\nawait browser.close();", documentation: "Playwright base template" },
];

// ============ Groovy Snippets ============
export const groovySnippets: MonacoSnippet[] = [
  { label: "pr", insertText: "println ${1:msg}", documentation: "Print line" },
  { label: "def", insertText: "def ${1:name} = ${2:value}", documentation: "Define variable" },
  { label: "cl", insertText: "class ${1:MyClass} {\n\t${2}\n}", documentation: "Class" },
  { label: "if", insertText: "if (${1:cond}) {\n\t${2}\n}", documentation: "If statement" },
  { label: "ife", insertText: "if (${1:cond}) {\n\t${2}\n} else {\n\t${3}\n}", documentation: "If-else" },
  { label: "switch", insertText: "switch(${1:x}) {\n\tcase ${2:a}:\n\t\t${3}\n\t\tbreak\n\tdefault:\n\t\t${4}\n}", documentation: "Switch" },
  { label: "fori", insertText: "for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}", documentation: "For loop" },
  { label: "forin", insertText: "for (${1:it} in ${2:iterable}) {\n\t${3}\n}", documentation: "For-in loop" },
  { label: "while", insertText: "while (${1:cond}) {\n\t${2}\n}", documentation: "While loop" },
  { label: "try", insertText: "try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n} finally {\n\t${5}\n}", documentation: "Try-catch" },
  { label: "fn", insertText: "def ${1:name}(${2:args}) {\n\t${3}\n}", documentation: "Function" },
  { label: "clo", insertText: "Closure ${1:c} = { ${2:args} -> ${3:body} }", documentation: "Closure" },
  { label: "list", insertText: "def ${1:l} = [${2:1, 2, 3}]", documentation: "List" },
  { label: "map", insertText: "def ${1:m} = [${2:key: value}]", documentation: "Map" },
  { label: "each", insertText: "${1:col}.each { ${2:it} -> ${3} }", documentation: "Each iterator" },
  { label: "collect", insertText: "def ${1:r} = ${2:col}.collect { ${3:it} -> ${4} }", documentation: "Collect/map" },
  { label: "find", insertText: "def ${1:x} = ${2:col}.find { ${3:it} -> ${4:cond} }", documentation: "Find" },
  { label: "findAll", insertText: "def ${1:x} = ${2:col}.findAll { ${3:it} -> ${4:cond} }", documentation: "Find all" },
  { label: "jsonp", insertText: "def ${1:obj} = new groovy.json.JsonSlurper().parseText(${2:jsonString})", documentation: "Parse JSON" },
  { label: "jsons", insertText: "def ${1:json} = groovy.json.JsonOutput.toJson(${2:obj})", documentation: "To JSON" },
  { label: "filer", insertText: "def ${1:text} = new File(${2:path}).text", documentation: "Read file" },
  { label: "filew", insertText: "new File(${1:path}).withWriter { w ->\n\tw << ${2:content}\n}", documentation: "Write file" },
  { label: "proc", insertText: "def p = \"${1:cmd}\".execute()\nprintln p.text", documentation: "Execute process" },
  { label: "httpget", insertText: "def url = new URL(${1:\"https://example.com\"})\ndef res = url.text", documentation: "HTTP GET" },
  { label: "t_start", insertText: "def t = Thread.start { ${1:// background work} }", documentation: "Start thread" },
  { label: "exec_fixed", insertText: "def pool = java.util.concurrent.Executors.newFixedThreadPool(${1:4})\ntry {\n\t${2}\n} finally {\n\tpool.shutdown()\n}", documentation: "Thread pool" },
];

// ============ Batch Snippets ============
export const batchSnippets: MonacoSnippet[] = [
  { label: "echo", insertText: "@echo ${1:on}", documentation: "Echo" },
  { label: "hdr", insertText: "@echo off\nsetlocal enabledelayedexpansion\nchcp 65001 >nul\nREM ${1:script header}", documentation: "Script header" },
  { label: "var", insertText: "set ${1:NAME}=${2:value}", documentation: "Set variable" },
  { label: "env", insertText: "echo %${1:NAME}%", documentation: "Echo variable" },
  { label: "if", insertText: "if ${1:condition} (\n\t${2:commands}\n) else (\n\t${3:commands}\n)", documentation: "If-else" },
  { label: "ifeq", insertText: "if /i \"%${1:VAR}%\"==\"${2:value}\" (\n\t${3}\n)", documentation: "If equal" },
  { label: "ifdef", insertText: "if defined ${1:VAR} (\n\t${2}\n)", documentation: "If defined" },
  { label: "ifexist", insertText: "if exist \"${1:path}\" (\n\t${2}\n)", documentation: "If file exists" },
  { label: "fori", insertText: "for /l %%${1:i} in (${2:1},${3:1},${4:10}) do (\n\t${5:echo %%${1:i}}\n)", documentation: "For loop" },
  { label: "forf", insertText: "for /f \"usebackq tokens=${1:*} delims=${2: }\" %%${3:a} in (\"${4:file}\") do (\n\t${5:echo %%${3:a}}\n)", documentation: "For /f" },
  { label: "goto", insertText: "goto ${1:label}", documentation: "Goto" },
  { label: "call", insertText: "call :${1:label} ${2:args}", documentation: "Call subroutine" },
  { label: "fn", insertText: ":${1:func}\nREM %~1.. are args\n${2:echo %~1}\nexit /b ${3:0}", documentation: "Function" },
  { label: "pause", insertText: "pause", documentation: "Pause" },
  { label: "sleep", insertText: "timeout /t ${1:5} /nobreak >nul", documentation: "Sleep" },
  { label: "read", insertText: "set /p ${1:VAR}=${2:Prompt}: ", documentation: "Read input" },
  { label: "cd", insertText: "cd /d \"${1:path}\"", documentation: "Change directory" },
  { label: "mkdir", insertText: "mkdir \"${1:dir}\"", documentation: "Make directory" },
  { label: "copy", insertText: "copy /y \"${1:src}\" \"${2:dst}\"", documentation: "Copy file" },
  { label: "del", insertText: "del /q \"${1:path}\"", documentation: "Delete file" },
  { label: "exitb", insertText: "exit /b ${1:0}", documentation: "Exit" },
];

// ============ PowerShell Snippets ============
export const powershellSnippets: MonacoSnippet[] = [
  { label: "hdr", insertText: "#requires -Version ${1:7.0}\nSet-StrictMode -Version Latest\n$ErrorActionPreference = '${2:Stop}'", documentation: "Script header" },
  { label: "echo", insertText: "Write-Host ${1:'Message'}", documentation: "Write-Host" },
  { label: "wri", insertText: "Write-Output ${1:'Value'}", documentation: "Write-Output" },
  { label: "param", insertText: "param(\n\t[Parameter(Mandatory=${1:\\$true})]\n\t[${2:string}]$${3:Name}\n)", documentation: "Parameter block" },
  { label: "fn", insertText: "function ${1:Invoke-Thing} {\n\tparam(${2})\n\t${3}\n}", documentation: "Function" },
  { label: "if", insertText: "if (${1:cond}) {\n\t${2}\n} elseif (${3:cond2}) {\n\t${4}\n} else {\n\t${5}\n}", documentation: "If statement" },
  { label: "try", insertText: "try {\n\t${1}\n} catch {\n\tWrite-Error \\$_\n} finally {\n\t${2}\n}", documentation: "Try-catch" },
  { label: "foreach", insertText: "foreach ($${1:item} in ${2:collection}) {\n\t${3}\n}", documentation: "Foreach loop" },
  { label: "pipe", insertText: "${1:Get-ChildItem} | Where-Object { ${2:\\$_.Length -gt 0} } | Select-Object ${3:Name,Length}", documentation: "Pipeline" },
  { label: "where", insertText: "Where-Object { ${1:\\$_ -match 'pattern'} }", documentation: "Where-Object" },
  { label: "select", insertText: "Select-Object ${1:Name,FullName}", documentation: "Select-Object" },
  { label: "json", insertText: "$json = ${1:obj} | ConvertTo-Json -Depth ${2:5}\n$json", documentation: "To JSON" },
  { label: "fromjson", insertText: "$obj = Get-Content \"${1:file.json}\" -Raw | ConvertFrom-Json", documentation: "From JSON" },
  { label: "iwr", insertText: "$r = Invoke-WebRequest -Uri \"${1:https://example.com}\" -UseBasicParsing\n$r.Content", documentation: "Web request" },
  { label: "irm", insertText: "$r = Invoke-RestMethod -Method ${1:GET} -Uri \"${2:https://api}\" -Headers @{ ${3:Authorization} = '${4:Bearer token}' }\n$r", documentation: "REST method" },
  { label: "fsread", insertText: "Get-Content -Path \"${1:path}\" -Encoding ${2:UTF8}", documentation: "Read file" },
  { label: "fswrite", insertText: "${1:'content'} | Set-Content -Path \"${2:path}\" -Encoding ${3:UTF8}", documentation: "Write file" },
  { label: "mkdir", insertText: "New-Item -ItemType Directory -Path \"${1:dir}\" -Force", documentation: "Make directory" },
  { label: "rm", insertText: "Remove-Item -Path \"${1:path}\" -Recurse -Force", documentation: "Remove item" },
  { label: "gci", insertText: "Get-ChildItem -Path \"${1:path}\" -Recurse -File", documentation: "Get children" },
  { label: "test", insertText: "if (Test-Path \"${1:path}\") {\n\t${2}\n}", documentation: "Test path" },
  { label: "startp", insertText: "Start-Process -FilePath \"${1:cmd.exe}\" -ArgumentList \"${2:/c dir}\" -Wait -NoNewWindow", documentation: "Start process" },
];

// Helper to create Monaco completion items
export function createCompletionItems(snippets: MonacoSnippet[]): languages.CompletionItem[] {
  return snippets.map((s, idx) => ({
    label: s.label,
    kind: 27, // Snippet
    insertText: s.insertText,
    insertTextRules: 4, // InsertAsSnippet
    documentation: s.documentation || '',
    sortText: String(idx).padStart(4, '0'),
  })) as languages.CompletionItem[];
}

// Get snippets for a language
export function getSnippetsForLanguage(language: string): MonacoSnippet[] {
  switch (language.toLowerCase()) {
    case 'javascript':
    case 'jsbackend':
    case 'playwright':
      return jsSnippets;
    case 'groovy':
      return groovySnippets;
    case 'batch':
    case 'bat':
      return batchSnippets;
    case 'powershell':
    case 'ps1':
      return powershellSnippets;
    default:
      return [];
  }
}
