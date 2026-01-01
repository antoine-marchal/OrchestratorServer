import type { languages } from 'monaco-editor';

export interface MonacoSnippet {
  label: string;
  insertText: string;
  documentation?: string;
}

export const pythonSnippets: MonacoSnippet[] = [
  // Basic I/O
  { label: "print", insertText: "print(${1:msg})", documentation: "Print to stdout" },
  { label: "input", insertText: "${1:var} = input(${2:'prompt: '})", documentation: "Read input from user" },

  // Variables and types
  { label: "var", insertText: "${1:name} = ${2:value}", documentation: "Variable assignment" },
  { label: "const", insertText: "${1:NAME}: Final = ${2:value}", documentation: "Constant (Final type hint)" },
  { label: "list", insertText: "${1:lst} = [${2:1, 2, 3}]", documentation: "Create a list" },
  { label: "dict", insertText: "${1:d} = {${2:'key'}: ${3:'value'}}", documentation: "Create a dictionary" },
  { label: "set", insertText: "${1:s} = {${2:1, 2, 3}}", documentation: "Create a set" },
  { label: "tuple", insertText: "${1:t} = (${2:1, 2, 3})", documentation: "Create a tuple" },

  // Functions
  { label: "def", insertText: "def ${1:func}(${2:args}):\n\t${3:pass}", documentation: "Define a function" },
  { label: "defr", insertText: "def ${1:func}(${2:args}) -> ${3:None}:\n\t${4:pass}", documentation: "Function with return type" },
  { label: "lambda", insertText: "lambda ${1:x}: ${2:x}", documentation: "Lambda function" },
  { label: "async", insertText: "async def ${1:func}(${2:args}):\n\t${3:pass}", documentation: "Async function" },
  { label: "await", insertText: "${1:result} = await ${2:coroutine}", documentation: "Await expression" },

  // Classes
  { label: "class", insertText: "class ${1:MyClass}:\n\tdef __init__(self${2:, args}):\n\t\t${3:pass}", documentation: "Define a class" },
  { label: "classih", insertText: "class ${1:MyClass}(${2:BaseClass}):\n\tdef __init__(self${3:, args}):\n\t\tsuper().__init__(${4})\n\t\t${5:pass}", documentation: "Class with inheritance" },
  { label: "dataclass", insertText: "@dataclass\nclass ${1:MyClass}:\n\t${2:name}: ${3:str}\n\t${4:value}: ${5:int} = ${6:0}", documentation: "Dataclass" },
  { label: "property", insertText: "@property\ndef ${1:name}(self):\n\treturn self._${1:name}\n\n@${1:name}.setter\ndef ${1:name}(self, value):\n\tself._${1:name} = value", documentation: "Property with getter/setter" },
  { label: "staticmethod", insertText: "@staticmethod\ndef ${1:method}(${2:args}):\n\t${3:pass}", documentation: "Static method" },
  { label: "classmethod", insertText: "@classmethod\ndef ${1:method}(cls${2:, args}):\n\t${3:pass}", documentation: "Class method" },

  // Control flow
  { label: "if", insertText: "if ${1:condition}:\n\t${2:pass}", documentation: "If statement" },
  { label: "ife", insertText: "if ${1:condition}:\n\t${2:pass}\nelse:\n\t${3:pass}", documentation: "If-else statement" },
  { label: "elif", insertText: "elif ${1:condition}:\n\t${2:pass}", documentation: "Elif clause" },
  { label: "ternary", insertText: "${1:true_val} if ${2:condition} else ${3:false_val}", documentation: "Ternary expression" },
  { label: "match", insertText: "match ${1:value}:\n\tcase ${2:pattern}:\n\t\t${3:pass}\n\tcase _:\n\t\t${4:pass}", documentation: "Match statement (3.10+)" },

  // Loops
  { label: "for", insertText: "for ${1:item} in ${2:iterable}:\n\t${3:pass}", documentation: "For loop" },
  { label: "fori", insertText: "for ${1:i} in range(${2:n}):\n\t${3:pass}", documentation: "For loop with range" },
  { label: "fore", insertText: "for ${1:i}, ${2:item} in enumerate(${3:iterable}):\n\t${4:pass}", documentation: "For loop with enumerate" },
  { label: "while", insertText: "while ${1:condition}:\n\t${2:pass}", documentation: "While loop" },
  { label: "comp", insertText: "[${1:x} for ${2:x} in ${3:iterable}]", documentation: "List comprehension" },
  { label: "compif", insertText: "[${1:x} for ${2:x} in ${3:iterable} if ${4:condition}]", documentation: "List comprehension with filter" },
  { label: "dictcomp", insertText: "{${1:k}: ${2:v} for ${3:k}, ${4:v} in ${5:items}}", documentation: "Dict comprehension" },
  { label: "genexp", insertText: "(${1:x} for ${2:x} in ${3:iterable})", documentation: "Generator expression" },

  // Exception handling
  { label: "try", insertText: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}", documentation: "Try-except block" },
  { label: "tryf", insertText: "try:\n\t${1:pass}\nexcept ${2:Exception} as ${3:e}:\n\t${4:pass}\nfinally:\n\t${5:pass}", documentation: "Try-except-finally" },
  { label: "raise", insertText: "raise ${1:ValueError}(${2:'message'})", documentation: "Raise exception" },
  { label: "assert", insertText: "assert ${1:condition}, ${2:'message'}", documentation: "Assert statement" },

  // Context managers
  { label: "with", insertText: "with ${1:context} as ${2:var}:\n\t${3:pass}", documentation: "With statement" },
  { label: "open", insertText: "with open(${1:'file.txt'}, ${2:'r'}) as ${3:f}:\n\t${4:content = f.read()}", documentation: "Open file" },
  { label: "openw", insertText: "with open(${1:'file.txt'}, ${2:'w'}) as ${3:f}:\n\t${4:f.write(content)}", documentation: "Open file for writing" },

  // Imports
  { label: "imp", insertText: "import ${1:module}", documentation: "Import module" },
  { label: "from", insertText: "from ${1:module} import ${2:name}", documentation: "Import from module" },
  { label: "fromas", insertText: "from ${1:module} import ${2:name} as ${3:alias}", documentation: "Import with alias" },

  // Common imports
  { label: "impos", insertText: "import os", documentation: "Import os" },
  { label: "impsys", insertText: "import sys", documentation: "Import sys" },
  { label: "impjson", insertText: "import json", documentation: "Import json" },
  { label: "impre", insertText: "import re", documentation: "Import re" },
  { label: "imppath", insertText: "from pathlib import Path", documentation: "Import Path" },
  { label: "impdatetime", insertText: "from datetime import datetime, timedelta", documentation: "Import datetime" },
  { label: "imptype", insertText: "from typing import List, Dict, Optional, Union, Tuple", documentation: "Import typing" },
  { label: "impasyncio", insertText: "import asyncio", documentation: "Import asyncio" },
  { label: "impreq", insertText: "import requests", documentation: "Import requests" },

  // File operations
  { label: "readfile", insertText: "with open(${1:'file.txt'}, 'r', encoding='utf-8') as f:\n\t${2:content} = f.read()", documentation: "Read entire file" },
  { label: "readlines", insertText: "with open(${1:'file.txt'}, 'r', encoding='utf-8') as f:\n\t${2:lines} = f.readlines()", documentation: "Read file lines" },
  { label: "writefile", insertText: "with open(${1:'file.txt'}, 'w', encoding='utf-8') as f:\n\tf.write(${2:content})", documentation: "Write to file" },
  { label: "jsonload", insertText: "with open(${1:'file.json'}, 'r') as f:\n\t${2:data} = json.load(f)", documentation: "Load JSON file" },
  { label: "jsondump", insertText: "with open(${1:'file.json'}, 'w') as f:\n\tjson.dump(${2:data}, f, indent=2)", documentation: "Dump JSON to file" },
  { label: "jsonp", insertText: "${1:obj} = json.loads(${2:json_str})", documentation: "Parse JSON string" },
  { label: "jsons", insertText: "${1:json_str} = json.dumps(${2:obj}, indent=2)", documentation: "Stringify to JSON" },

  // String operations
  { label: "fstring", insertText: "f\"${1:text} {${2:var}}\"", documentation: "F-string" },
  { label: "join", insertText: "${1:', '}.join(${2:iterable})", documentation: "Join strings" },
  { label: "split", insertText: "${1:text}.split(${2:' '})", documentation: "Split string" },
  { label: "strip", insertText: "${1:text}.strip()", documentation: "Strip whitespace" },
  { label: "replace", insertText: "${1:text}.replace(${2:'old'}, ${3:'new'})", documentation: "Replace in string" },
  { label: "regex", insertText: "import re\n${1:match} = re.${2:search}(r'${3:pattern}', ${4:text})", documentation: "Regex search" },
  { label: "regexall", insertText: "import re\n${1:matches} = re.findall(r'${2:pattern}', ${3:text})", documentation: "Regex find all" },

  // Collections
  { label: "map", insertText: "list(map(${1:func}, ${2:iterable}))", documentation: "Map function" },
  { label: "filter", insertText: "list(filter(${1:func}, ${2:iterable}))", documentation: "Filter function" },
  { label: "reduce", insertText: "from functools import reduce\n${1:result} = reduce(${2:func}, ${3:iterable})", documentation: "Reduce function" },
  { label: "sorted", insertText: "sorted(${1:iterable}, key=${2:lambda x: x})", documentation: "Sort iterable" },
  { label: "zip", insertText: "list(zip(${1:iter1}, ${2:iter2}))", documentation: "Zip iterables" },
  { label: "any", insertText: "any(${1:condition} for ${2:x} in ${3:iterable})", documentation: "Any match" },
  { label: "all", insertText: "all(${1:condition} for ${2:x} in ${3:iterable})", documentation: "All match" },

  // Main
  { label: "main", insertText: "def main():\n\t${1:pass}\n\n\nif __name__ == '__main__':\n\tmain()", documentation: "Main function pattern" },
  { label: "ifmain", insertText: "if __name__ == '__main__':\n\t${1:pass}", documentation: "Main guard" },
  { label: "argparse", insertText: "import argparse\n\nparser = argparse.ArgumentParser(description='${1:Description}')\nparser.add_argument('${2:--arg}', type=${3:str}, default=${4:None}, help='${5:help}')\nargs = parser.parse_args()", documentation: "Argument parser" },

  // Logging
  { label: "logging", insertText: "import logging\n\nlogging.basicConfig(level=logging.${1:INFO}, format='%(asctime)s - %(levelname)s - %(message)s')\nlogger = logging.getLogger(__name__)", documentation: "Setup logging" },
  { label: "logd", insertText: "logger.debug(${1:'message'})", documentation: "Log debug" },
  { label: "logi", insertText: "logger.info(${1:'message'})", documentation: "Log info" },
  { label: "logw", insertText: "logger.warning(${1:'message'})", documentation: "Log warning" },
  { label: "loge", insertText: "logger.error(${1:'message'})", documentation: "Log error" },

  // HTTP requests
  { label: "reqget", insertText: "import requests\n\n${1:response} = requests.get(${2:'url'}, headers=${3:{}})\n${1:response}.raise_for_status()\n${4:data} = ${1:response}.json()", documentation: "HTTP GET request" },
  { label: "reqpost", insertText: "import requests\n\n${1:response} = requests.post(${2:'url'}, json=${3:{}}, headers=${4:{}})\n${1:response}.raise_for_status()\n${5:data} = ${1:response}.json()", documentation: "HTTP POST request" },

  // Async
  { label: "asyncmain", insertText: "import asyncio\n\nasync def main():\n\t${1:pass}\n\n\nif __name__ == '__main__':\n\tasyncio.run(main())", documentation: "Async main pattern" },
  { label: "gather", insertText: "${1:results} = await asyncio.gather(${2:coros})", documentation: "Gather coroutines" },
  { label: "asyncwith", insertText: "async with ${1:context} as ${2:var}:\n\t${3:pass}", documentation: "Async context manager" },
  { label: "asyncfor", insertText: "async for ${1:item} in ${2:async_iterable}:\n\t${3:pass}", documentation: "Async for loop" },

  // Type hints
  { label: "typelist", insertText: "List[${1:str}]", documentation: "List type hint" },
  { label: "typedict", insertText: "Dict[${1:str}, ${2:Any}]", documentation: "Dict type hint" },
  { label: "typeopt", insertText: "Optional[${1:str}]", documentation: "Optional type hint" },
  { label: "typeunion", insertText: "Union[${1:str}, ${2:int}]", documentation: "Union type hint" },
  { label: "typetuple", insertText: "Tuple[${1:str}, ${2:int}]", documentation: "Tuple type hint" },
  { label: "typecallable", insertText: "Callable[[${1:Args}], ${2:Return}]", documentation: "Callable type hint" },

  // Testing
  { label: "unittest", insertText: "import unittest\n\n\nclass ${1:Test}(unittest.TestCase):\n\tdef test_${2:example}(self):\n\t\t${3:self.assertEqual(1, 1)}\n\n\nif __name__ == '__main__':\n\tunittest.main()", documentation: "Unittest class" },
  { label: "pytest", insertText: "import pytest\n\n\ndef test_${1:example}():\n\t${2:assert True}", documentation: "Pytest function" },
  { label: "fixture", insertText: "@pytest.fixture\ndef ${1:fixture_name}():\n\t${2:return value}", documentation: "Pytest fixture" },

  // Decorators
  { label: "decorator", insertText: "def ${1:decorator}(func):\n\tdef wrapper(*args, **kwargs):\n\t\t${2:# before}\n\t\tresult = func(*args, **kwargs)\n\t\t${3:# after}\n\t\treturn result\n\treturn wrapper", documentation: "Decorator function" },
  { label: "timer", insertText: "import time\n\ndef timer(func):\n\tdef wrapper(*args, **kwargs):\n\t\tstart = time.time()\n\t\tresult = func(*args, **kwargs)\n\t\tprint(f'{func.__name__} took {time.time() - start:.2f}s')\n\t\treturn result\n\treturn wrapper", documentation: "Timer decorator" },

  // Misc
  { label: "envget", insertText: "import os\n${1:value} = os.environ.get(${2:'VAR_NAME'}, ${3:'default'})", documentation: "Get env variable" },
  { label: "sleep", insertText: "import time\ntime.sleep(${1:1})", documentation: "Sleep" },
  { label: "uuid", insertText: "import uuid\n${1:id} = str(uuid.uuid4())", documentation: "Generate UUID" },
  { label: "datetime", insertText: "from datetime import datetime\n${1:now} = datetime.now()", documentation: "Current datetime" },
  { label: "timestamp", insertText: "import time\n${1:ts} = int(time.time())", documentation: "Unix timestamp" },
];

export function getPythonCompletionItems(): languages.CompletionItem[] {
  return pythonSnippets.map((s, idx) => ({
    label: s.label,
    kind: 27, // Snippet
    insertText: s.insertText,
    insertTextRules: 4, // InsertAsSnippet
    documentation: s.documentation,
    sortText: String(idx).padStart(4, '0'),
  })) as languages.CompletionItem[];
}
