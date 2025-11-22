type Snippet = { trig: string; body: string };

const toSnippetText = ({ trig, body }: Snippet) =>
  "snippet " + trig + "\n\t" + body.replace(/\r/g, "").replace(/\n/g, "\n\t");

/* =========================
   Windows Batch (.bat / .cmd)
   ========================= */
export function registerBatchSnippets(snippetManager: any) {
  const core: Snippet[] = [
    { trig: "echo", body: "@echo ${1:on}${0}" },
    { trig: "hdr", body: "@echo off\nsetlocal enabledelayedexpansion\nchcp 65001 >nul\nREM ${1:script header}\n${0}" },
    { trig: "var", body: "set ${1:NAME}=${2:value}${0}" },
    { trig: "env", body: "echo %${1:NAME}%${0}" },
    { trig: "if", body: "if ${1:condition} (\n\t${2:commands}\n) else (\n\t${3:commands}\n)${0}" },
    { trig: "ife", body: "if ${1:condition} (\n\t${2:commands}\n)${0}" },
    { trig: "ifeq", body: "if /i \"%${1:VAR}%\"==\"${2:value}\" (\n\t${3}\n)${0}" },
    { trig: "ifne", body: "if /i not \"%${1:VAR}%\"==\"${2:value}\" (\n\t${3}\n)${0}" },
    { trig: "ifdef", body: "if defined ${1:VAR} (\n\t${2}\n)${0}" },
    { trig: "ifndef", body: "if not defined ${1:VAR} (\n\t${2}\n)${0}" },
    { trig: "ifexist", body: "if exist \"${1:path}\" (\n\t${2}\n)${0}" },
    { trig: "ifnexist", body: "if not exist \"${1:path}\" (\n\t${2}\n)${0}" },
    { trig: "fori", body: "for /l %%${1:i} in (${2:1},${3:1},${4:10}) do (\n\t${5:echo %%${1:i}}\n)${0}" },
    { trig: "forf", body: "for /f \"usebackq tokens=${1:*} delims=${2: }\" %%${3:a} in (\"${4:file}\") do (\n\t${5:echo %%${3:a}}\n)${0}" },
    { trig: "forin", body: "for %%${1:f} in (${2:*.txt}) do (\n\t${3:echo %%~nf}\n)${0}" },
    { trig: "label", body: ":${1:label}\n${0}" },
    { trig: "goto", body: "goto ${1:label}${0}" },
    { trig: "call", body: "call :${1:label} ${2:args}\n${0}" },
    { trig: "fn", body: ":${1:func}\nREM %~1.. are args\n${2:echo %~1}\nexit /b ${3:0}\n${0}" },
    { trig: "pause", body: "pause${0}" },
    { trig: "sleep", body: "timeout /t ${1:5} /nobreak >nul${0}" },
    { trig: "read", body: "set /p ${1:VAR}=${2:Prompt}: ${0}" },
    { trig: "choice", body: "choice /c ${1:YN} /m \"${2:Message}\"\nif errorlevel ${3:2} ${4:echo No}\nif errorlevel ${5:1} ${6:echo Yes}${0}" },
    { trig: "print", body: "echo ${1:message}${0}" },
    { trig: "redir", body: "${1:command} >\"${2:out.txt}\" 2>\"${3:err.txt}\"${0}" },
    { trig: "pipe", body: "${1:command} | ${2:findstr} ${3:pattern}${0}" },
    { trig: "setp", body: "set \"PATH=%PATH%;${1:C:\\path}\"${0}" },
    { trig: "cd", body: "cd /d \"${1:path}\"${0}" },
    { trig: "pushd", body: "pushd \"${1:path}\"\n${2:commands}\npopd${0}" },
    { trig: "mkdir", body: "mkdir \"${1:dir}\"${0}" },
    { trig: "copy", body: "copy /y \"${1:src}\" \"${2:dst}\"${0}" },
    { trig: "move", body: "move /y \"${1:src}\" \"${2:dst}\"${0}" },
    { trig: "del", body: "del /q \"${1:path}\"${0}" },
    { trig: "ren", body: "ren \"${1:old}\" \"${2:new}\"${0}" },
    { trig: "robocopy", body: "robocopy \"${1:src}\" \"${2:dst}\" ${3:*.*} /e /r:${4:1} /w:${5:1}${0}" },
    { trig: "exitb", body: "exit /b ${1:0}${0}" },
    { trig: "errlvl", body: "if errorlevel ${1:1} (\n\t${2:echo error}\n\texit /b ${3:1}\n)${0}" },
    { trig: "args", body: "echo Script path: %~f0\necho Arg1 name: %~n1\necho Arg1 dir : %~dp1${0}" },
    { trig: "selfdir", body: "set \"BASEDIR=%~dp0\"\ncd /d \"%BASEDIR%\"${0}" },
    { trig: "findstr", body: "findstr /i /r \"${1:pattern}\" \"${2:file}\"${0}" },
    { trig: "powershell", body: "powershell -NoProfile -ExecutionPolicy Bypass -Command \"${1:Write-Host 'Hello'}\"${0}" },
    { trig: "curl", body: "curl -L -o \"${1:file}\" \"${2:https://url}\"${0}" },
    { trig: "bits", body: "bitsadmin /transfer ${1:JobName} /download /priority high \"${2:url}\" \"${3:dest}\"${0}" },
    { trig: "regset", body: "reg add \"${1:HKCU\\Software\\Key}\" /v \"${2:Name}\" /t ${3:REG_SZ} /d \"${4:Value}\" /f${0}" },
    { trig: "regget", body: "reg query \"${1:HKCU\\Software\\Key}\" /v \"${2:Name}\"${0}" },
    { trig: "svc", body: "sc ${1:start|stop|query} \"${2:ServiceName}\"${0}" },
    { trig: "netsh", body: "netsh ${1:interface ip show config}${0}" },
    { trig: "taskkill", body: "taskkill /im \"${1:process}.exe\" /f${0}" },
    { trig: "wmic", body: "wmic process where \"name='${1:proc}.exe'\" get ${2:ProcessId,CommandLine}${0}" },
    { trig: "log", body: "echo [%date% %time%] ${1:message}>> \"${2:script}.log\"${0}" }
  ];

  const file = core.map(toSnippetText).join("\n");
  snippetManager.register(snippetManager.parseSnippetFile(file), "batchfile");
}

/* =============
   PowerShell
   ============= */
export function registerPowershellSnippets(snippetManager: any) {
  const core: Snippet[] = [
    { trig: "hdr", body: "#requires -Version ${1:7.0}\nSet-StrictMode -Version Latest\n$ErrorActionPreference = '${2:Stop}'\n${0}" },
    { trig: "echo", body: "Write-Host ${1:'Message'}${0}" },
    { trig: "wri", body: "Write-Output ${1:'Value'}${0}" },
    { trig: "imp", body: "Import-Module ${1:ModuleName}${0}" },
    { trig: "param", body: "param(\n\t[Parameter(Mandatory=${1:$true})]\n\t[${2:string}]$${3:Name}\n)\n${0}" },
    { trig: "fn", body: "function ${1:Invoke-Thing} {\n\tparam(${2})\n\t${3}\n}${0}" },
    { trig: "afn", body: "function ${1:Get-Data} {\n\t[CmdletBinding()]\n\tparam(\n\t\t[Parameter(Mandatory=${2:$false}, ValueFromPipeline=${3:$false})]\n\t\t[${4:string}]$${5:Name}\n\t)\n\tbegin { ${6:# init} }\n\tprocess { ${7:# per-item} }\n\tend { ${8:# finalize} }\n}${0}" },
    { trig: "if", body: "if (${1:cond}) {\n\t${2}\n} elseif (${3:cond2}) {\n\t${4}\n} else {\n\t${5}\n}${0}" },
    { trig: "try", body: "try {\n\t${1}\n} catch {\n\tWrite-Error $_\n} finally {\n\t${2}\n}${0}" },
    { trig: "foreach", body: "foreach ($${1:item} in ${2:collection}) {\n\t${3}\n}${0}" },
    { trig: "pipe", body: "${1:Get-ChildItem} | Where-Object { ${2:\$_\.Length -gt 0} } | Select-Object ${3:Name,Length}${0}" },
    { trig: "where", body: "Where-Object { ${1:\$_ -match 'pattern'} }${0}" },
    { trig: "select", body: "Select-Object ${1:Name,FullName}${0}" },
    { trig: "sort", body: "Sort-Object ${1:Property} -Descending:${2:$false}${0}" },
    { trig: "json", body: "$json = ${1:obj} | ConvertTo-Json -Depth ${2:5}\n$json${0}" },
    { trig: "fromjson", body: "$obj = Get-Content \"${1:file.json}\" -Raw | ConvertFrom-Json${0}" },
    { trig: "iwr", body: "$r = Invoke-WebRequest -Uri \"${1:https://example.com}\" -UseBasicParsing\n$r.Content${0}" },
    { trig: "irm", body: "$r = Invoke-RestMethod -Method ${1:GET} -Uri \"${2:https://api}\" -Headers @{ ${3:Authorization} = '${4:Bearer token}' }\n$r${0}" },
    { trig: "fsread", body: "Get-Content -Path \"${1:path}\" -Encoding ${2:UTF8}${0}" },
    { trig: "fswrite", body: "${1:'content'} | Set-Content -Path \"${2:path}\" -Encoding ${3:UTF8}${0}" },
    { trig: "append", body: "${1:'content'} | Add-Content -Path \"${2:path}\"${0}" },
    { trig: "mkdir", body: "New-Item -ItemType Directory -Path \"${1:dir}\" -Force${0}" },
    { trig: "rm", body: "Remove-Item -Path \"${1:path}\" -Recurse -Force${0}" },
    { trig: "gci", body: "Get-ChildItem -Path \"${1:path}\" -Recurse -File${0}" },
    { trig: "join", body: "Join-Path -Path ${1:$PSScriptRoot} -ChildPath \"${2:child}\"${0}" },
    { trig: "test", body: "if (Test-Path \"${1:path}\") {\n\t${2}\n}${0}" },
    { trig: "startp", body: "Start-Process -FilePath \"${1:cmd.exe}\" -ArgumentList \"${2:/c dir}\" -Wait -NoNewWindow${0}" },
    { trig: "creds", body: "$sec = ConvertTo-SecureString \"${1:password}\" -AsPlainText -Force\n$cred = New-Object System.Management.Automation.PSCredential (${2:'user'}, $sec)${0}" },
    { trig: "transcript", body: "Start-Transcript -Path \"${1:script}.log\" -Append\n${2:# commands}\nStop-Transcript${0}" },
    { trig: "measure", body: "Measure-Command { ${1:Invoke-Thing} }${0}" },
    { trig: "regex", body: "if (${1:text} -match '${2:pattern}') {\n\t$matches[${3:1}]\n}${0}" },
    { trig: "switch", body: "switch (${1:value}) {\n\t'${2:a}' { ${3}; break }\n\tDefault { ${4} }\n}${0}" },
    { trig: "csvexp", body: "${1:data} | Export-Csv -Path \"${2:out.csv}\" -NoTypeInformation -Encoding UTF8${0}" },
    { trig: "csvimp", body: "$rows = Import-Csv -Path \"${1:in.csv}\"${0}" },
    { trig: "errtrap", body: "trap {\n\tWrite-Error $_\n\tcontinue\n}${0}" },
    { trig: "splat", body: "$params = @{ Method = '${1:GET}'; Uri = '${2:https://api}'; Headers = @{ } }\nInvoke-RestMethod @params${0}" },
    { trig: "job", body: "$j = Start-Job -ScriptBlock { ${1:Start-Sleep 2; 'done'} }\nWait-Job $j | Out-Null\nReceive-Job $j${0}" },
    { trig: "psclass", body: "class ${1:Thing} {\n\t[${2:string}]$${3:Name}\n\t${1:Thing}([${2:string}]$${3:Name}) { $this.${3:Name} = $${3:Name} }\n\t[string] ToString() { return $this.${3:Name} }\n}${0}" },
    { trig: "paramfile", body: "$PSScriptRoot${0}" },
    { trig: "dot", body: ". \"$PSScriptRoot\\${1:Utils}.ps1\"${0}" },
    { trig: "help", body: "<#\n.SYNOPSIS\n\t${1:Summary}\n.DESCRIPTION\n\t${2:Description}\n.PARAMETER ${3:Name}\n\t${4:Details}\n.EXAMPLE\n\t${5:Example}\n#>${0}" },
  ];

  const file = core.map(toSnippetText).join("\n");
  snippetManager.register(snippetManager.parseSnippetFile(file), "powershell");
}
