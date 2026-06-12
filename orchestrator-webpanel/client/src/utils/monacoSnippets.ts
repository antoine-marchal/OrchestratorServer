import type { languages } from 'monaco-editor';

export interface MonacoSnippet {
  label: string;
  insertText: string;
  documentation?: string;
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
  // Full working Playwright scrape — runs cleanly under the orchestrator's
  // backend-JS node. `headless: true` is required when the server runs in a
  // non-interactive session; flip to `false` only when launching from an
  // interactive desktop.
  { label: "pw-scrape", insertText: "import { chromium } from 'playwright';\n\nconst browser = await chromium.launch({ channel: '${1:msedge}', headless: ${2:true} });\ntry {\n\tconst context = await browser.newContext();\n\tconst page = await context.newPage();\n\tawait page.goto('${3:https://example.com}', { waitUntil: 'load', timeout: 30000 });\n\tconst title = await page.title();\n\tconst html = await page.content();\n\toutput = { title, url: page.url(), htmlLength: html.length };\n} finally {\n\tawait browser.close();\n}", documentation: "Playwright full scrape — headless, msedge channel, browser.close in finally" },
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

// ============ Python Snippets ============
export const pythonSnippets: MonacoSnippet[] = [
  { label: "print", insertText: "print(${1:msg})", documentation: "Print to stdout" },
  { label: "input", insertText: "${1:var} = input(${2:'prompt: '})", documentation: "Read input from user" },
  { label: "var", insertText: "${1:name} = ${2:value}", documentation: "Variable assignment" },
  { label: "list", insertText: "${1:lst} = [${2:1, 2, 3}]", documentation: "Create a list" },
  { label: "dict", insertText: "${1:d} = {${2:'key'}: ${3:'value'}}", documentation: "Create a dictionary" },
  { label: "set", insertText: "${1:s} = {${2:1, 2, 3}}", documentation: "Create a set" },
  { label: "tuple", insertText: "${1:t} = (${2:1, 2, 3})", documentation: "Create a tuple" },
  { label: "def", insertText: "def ${1:func}(${2:args}):\n\t${3:pass}", documentation: "Define a function" },
  { label: "defr", insertText: "def ${1:func}(${2:args}) -> ${3:None}:\n\t${4:pass}", documentation: "Function with return type" },
  { label: "lambda", insertText: "lambda ${1:x}: ${2:x}", documentation: "Lambda function" },
  { label: "async", insertText: "async def ${1:func}(${2:args}):\n\t${3:pass}", documentation: "Async function" },
  { label: "await", insertText: "${1:result} = await ${2:coroutine}", documentation: "Await expression" },
  { label: "class", insertText: "class ${1:MyClass}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}", documentation: "Define a class" },
  { label: "classih", insertText: "class ${1:MyClass}(${2:BaseClass}):\n\tdef __init__(self${3:, args}):\n\t\tsuper().__init__(${4})\n\t\t${5:pass}", documentation: "Class with inheritance" },
  { label: "dataclass", insertText: "@dataclass\nclass ${1:MyClass}:\n\t${2:name}: ${3:str}\n\t${4:value}: ${5:int} = ${6:0}", documentation: "Dataclass" },
  { label: "property", insertText: "@property\ndef ${1:name}(self):\n\treturn self._${1:name}\n\n@${1:name}.setter\ndef ${1:name}(self, value):\n\tself._${1:name} = value", documentation: "Property with getter/setter" },
  { label: "staticmethod", insertText: "@staticmethod\ndef ${1:method}(${2:args}):\n\t${3:pass}", documentation: "Static method" },
  { label: "classmethod", insertText: "@classmethod\ndef ${1:method}(cls${2:, args}):\n\t${3:pass}", documentation: "Class method" },
  { label: "if", insertText: "if ${1:condition}:\n\t${2:pass}", documentation: "If statement" },
  { label: "ife", insertText: "if ${1:condition}:\n\t${2:pass}\nelse:\n\t${3:pass}", documentation: "If-else statement" },
  { label: "elif", insertText: "elif ${1:condition}:\n\t${2:pass}", documentation: "Elif clause" },
  { label: "ternary", insertText: "${1:true_val} if ${2:condition} else ${3:false_val}", documentation: "Ternary expression" },
  { label: "match", insertText: "match ${1:value}:\n\tcase ${2:pattern}:\n\t\t${3:pass}\n\tcase _:\n\t\t${4:pass}", documentation: "Match statement (3.10+)" },
  { label: "for", insertText: "for ${1:item} in ${2:iterable}:\n\t${3:pass}", documentation: "For loop" },
  { label: "fori", insertText: "for ${1:i} in range(${2:n}):\n\t${3:pass}", documentation: "For loop with range" },
  { label: "fore", insertText: "for ${1:i}, ${2:item} in enumerate(${3:iterable}):\n\t${4:pass}", documentation: "For loop with enumerate" },
  { label: "while", insertText: "while ${1:condition}:\n\t${2:pass}", documentation: "While loop" },
  { label: "comp", insertText: "[${1:x} for ${2:x} in ${3:iterable}]", documentation: "List comprehension" },
  { label: "compif", insertText: "[${1:x} for ${2:x} in ${3:iterable} if ${4:condition}]", documentation: "List comprehension with filter" },
  { label: "dictcomp", insertText: "{${1:k}: ${2:v} for ${3:k}, ${4:v} in ${5:items}}", documentation: "Dict comprehension" },
  { label: "try", insertText: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}", documentation: "Try-except block" },
  { label: "tryf", insertText: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}\nfinally:\n\t${5:pass}", documentation: "Try-except-finally" },
  { label: "raise", insertText: "raise ${1:ValueError}(${2:'message'})", documentation: "Raise exception" },
  { label: "assert", insertText: "assert ${1:condition}, ${2:'message'}", documentation: "Assert statement" },
  { label: "with", insertText: "with ${1:context} as ${2:var}:\n\t${3:pass}", documentation: "With statement" },
  { label: "open", insertText: "with open(${1:'file.txt'}, ${2:'r'}) as ${3:f}:\n\t${4:content = f.read()}", documentation: "Open file" },
  { label: "openw", insertText: "with open(${1:'file.txt'}, ${2:'w'}) as ${3:f}:\n\t${4:f.write(content)}", documentation: "Open file for writing" },
  { label: "imp", insertText: "import ${1:module}", documentation: "Import module" },
  { label: "from", insertText: "from ${1:module} import ${2:name}", documentation: "Import from module" },
  { label: "fromas", insertText: "from ${1:module} import ${2:name} as ${3:alias}", documentation: "Import with alias" },
  { label: "imppath", insertText: "from pathlib import Path", documentation: "Import Path" },
  { label: "impdatetime", insertText: "from datetime import datetime, timedelta", documentation: "Import datetime" },
  { label: "impasyncio", insertText: "import asyncio", documentation: "Import asyncio" },
  { label: "impreq", insertText: "import requests", documentation: "Import requests" },
  { label: "readfile", insertText: "with open(${1:'file.txt'}, 'r', encoding='utf-8') as f:\n\t${2:content} = f.read()", documentation: "Read entire file" },
  { label: "writefile", insertText: "with open(${1:'file.txt'}, 'w', encoding='utf-8') as f:\n\tf.write(${2:content})", documentation: "Write to file" },
  { label: "jsonp", insertText: "${1:obj} = json.loads(${2:json_str})", documentation: "Parse JSON string" },
  { label: "jsons", insertText: "${1:json_str} = json.dumps(${2:obj}, indent=2)", documentation: "Stringify to JSON" },
  { label: "fstring", insertText: "f\"${1:text} {${2:var}}\"", documentation: "F-string" },
  { label: "join", insertText: "${1:', '}.join(${2:iterable})", documentation: "Join strings" },
  { label: "split", insertText: "${1:text}.split(${2:' '})", documentation: "Split string" },
  { label: "regex", insertText: "import re\n${1:match} = re.${2:search}(r'${3:pattern}', ${4:text})", documentation: "Regex search" },
  { label: "map", insertText: "list(map(${1:func}, ${2:iterable}))", documentation: "Map function" },
  { label: "filter", insertText: "list(filter(${1:func}, ${2:iterable}))", documentation: "Filter function" },
  { label: "sorted", insertText: "sorted(${1:iterable}, key=${2:lambda x: x})", documentation: "Sort iterable" },
  { label: "zip", insertText: "list(zip(${1:iter1}, ${2:iter2}))", documentation: "Zip iterables" },
  { label: "main", insertText: "def main():\n\t${1:pass}\n\n\nif __name__ == '__main__':\n\tmain()", documentation: "Main function pattern" },
  { label: "ifmain", insertText: "if __name__ == '__main__':\n\t${1:pass}", documentation: "Main guard" },
  { label: "argparse", insertText: "import argparse\n\nparser = argparse.ArgumentParser(description='${1:Description}')\nparser.add_argument('${2:--arg}', type=${3:str}, default=${4:None}, help='${5:help}')\nargs = parser.parse_args()", documentation: "Argument parser" },
  { label: "logging", insertText: "import logging\n\nlogging.basicConfig(level=logging.${1:INFO}, format='%(asctime)s - %(levelname)s - %(message)s')\nlogger = logging.getLogger(__name__)", documentation: "Setup logging" },
  { label: "reqget", insertText: "import requests\n\n${1:response} = requests.get(${2:'url'}, headers=${3:{}})\n${1:response}.raise_for_status()\n${4:data} = ${1:response}.json()", documentation: "HTTP GET request" },
  { label: "reqpost", insertText: "import requests\n\n${1:response} = requests.post(${2:'url'}, json=${3:{}}, headers=${4:{}})\n${1:response}.raise_for_status()\n${5:data} = ${1:response}.json()", documentation: "HTTP POST request" },
  { label: "asyncmain", insertText: "import asyncio\n\nasync def main():\n\t${1:pass}\n\n\nif __name__ == '__main__':\n\tasyncio.run(main())", documentation: "Async main pattern" },
  { label: "gather", insertText: "${1:results} = await asyncio.gather(${2:coros})", documentation: "Gather coroutines" },
  { label: "envget", insertText: "import os\n${1:value} = os.environ.get(${2:'VAR_NAME'}, ${3:'default'})", documentation: "Get env variable" },
  { label: "sleep", insertText: "import time\ntime.sleep(${1:1})", documentation: "Sleep" },
  { label: "uuid", insertText: "import uuid\n${1:id} = str(uuid.uuid4())", documentation: "Generate UUID" },
  { label: "datetime", insertText: "from datetime import datetime\n${1:now} = datetime.now()", documentation: "Current datetime" },
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
    case 'python':
    case 'py':
      return pythonSnippets;
    default:
      return [];
  }
}
