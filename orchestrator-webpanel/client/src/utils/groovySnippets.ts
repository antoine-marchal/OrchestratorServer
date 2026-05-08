type Snippet = { trig: string; body: string };

const toSnippetText = ({ trig, body }: Snippet) =>
  "snippet " + trig + "\n\t" + body.replace(/\r/g, "").replace(/\n/g, "\n\t");

export function registerGroovySnippets(snippetManager: any) {
  const core: Snippet[] = [
    { trig: "pr", body: 'println ${1:msg}${0}' },
    { trig: "def", body: 'def ${1:name} = ${2:value}${0}' },
    { trig: "cl", body: 'class ${1:MyClass} {\n\t${2}\n}\n${0}' },
    { trig: "int", body: 'int ${1:n} = ${2:0}${0}' },
    { trig: "str", body: 'String ${1:s} = "${2:text}"${0}' },
    { trig: "gstr", body: 'def ${1:s} = "${2:Hello}, ${3:name}!"${0}' },
    { trig: "if", body: 'if (${1:cond}) {\n\t${2}\n}${0}' },
    { trig: "ife", body: 'if (${1:cond}) {\n\t${2}\n} else {\n\t${3}\n}${0}' },
    { trig: "switch", body: 'switch(${1:x}) {\n\tcase ${2:a}:\n\t\t${3}\n\t\tbreak\n\tdefault:\n\t\t${4}\n}${0}' },
    { trig: "fori", body: 'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n\t${3}\n}${0}' },
    { trig: "forin", body: 'for (${1:it} in ${2:iterable}) {\n\t${3}\n}${0}' },
    { trig: "while", body: 'while (${1:cond}) {\n\t${2}\n}${0}' },
    { trig: "try", body: 'try {\n\t${1}\n} catch (${2:Exception} ${3:e}) {\n\t${4}\n} finally {\n\t${5}\n}${0}' },
    { trig: "fn", body: 'def ${1:name}(${2:args}) {\n\t${3}\n}\n${0}' },
    { trig: "clo", body: 'Closure ${1:c} = { ${2:args} -> ${3:body} }${0}' },
    { trig: "range", body: 'def ${1:r} = ${2:start}..${3:end}${0}' },
    { trig: "elvis", body: 'def ${1:v} = ${2:maybe} ?: ${3:default}${0}' },
    { trig: "safenav", body: 'def ${1:v} = ${2:obj}?.${3:prop}${0}' },
    { trig: "regex", body: 'def ${1:m} = (${2:text} =~ /${3:pattern}/)\nif (${1:m}) { ${4} }${0}' },
    { trig: "scan", body: 'new File(${1:path}).eachLine { line ->\n\t${2}\n}${0}' },
    { trig: "filew", body: 'new File(${1:path}).withWriter { w ->\n\tw << ${2:content}\n}${0}' },
    { trig: "filer", body: 'def ${1:text} = new File(${2:path}).text${0}' },
    { trig: "jsonp", body: 'def ${1:obj} = new groovy.json.JsonSlurper().parseText(${2:jsonString})${0}' },
    { trig: "jsons", body: 'def ${1:json} = groovy.json.JsonOutput.toJson(${2:obj})${0}' },
    { trig: "httpget", body: 'def url = new URL(${1:"https://example.com"})\ndef res = url.text\n${0}' },
    { trig: "httpbuilder", body: 'def http = new groovyx.net.http.HTTPBuilder(${1:"https://api"})\nhttp.get(path: ${2:"/resource"}) { resp, reader ->\n\t${3}\n}\n${0}' },
    { trig: "list", body: 'def ${1:l} = [${2:1,2,3}]${0}' },
    { trig: "map", body: 'def ${1:m} = [${2:key:value}]${0}' },
    { trig: "each", body: '${1:col}.each { ${2:it} -> ${3} }${0}' },
    { trig: "collect", body: 'def ${1:r} = ${2:col}.collect { ${3:it} -> ${4} }${0}' },
    { trig: "find", body: 'def ${1:x} = ${2:col}.find { ${3:it} -> ${4:cond} }${0}' },
    { trig: "findAll", body: 'def ${1:x} = ${2:col}.findAll { ${3:it} -> ${4:cond} }${0}' },
    { trig: "groupBy", body: 'def ${1:g} = ${2:col}.groupBy { ${3:it}.${4:key} }${0}' },
    { trig: "sort", body: 'def ${1:s} = ${2:col}.sort { a, b -> ${3:a <=> b} }${0}' },
    { trig: "unique", body: 'def ${1:u} = ${2:col}.unique()${0}' },
    { trig: "inject", body: 'def ${1:sum} = ${2:col}.inject(${3:0}) { acc, it -> ${4:acc + it} }${0}' },
    { trig: "with", body: '${1:obj}.with {\n\t${2}\n}${0}' },
    { trig: "tap", body: '${1:obj}.tap {\n\t${2}\n}${0}' },
    { trig: "memo", body: 'def ${1:f} = { ${2:x} -> ${3:body} }.memoize()${0}' },
    { trig: "assert", body: 'assert ${1:expr} : "${2:message}"${0}' },
    { trig: "time", body: 'def t0 = System.nanoTime()\n${1}\ndef dt = (System.nanoTime() - t0) / 1e6\nprintln "Elapsed ms: $dt"${0}' },
  ];

  const ops = [
    ["any", "any { it ${1:> 0} }"],
    ["every", "every { it ${1:> 0} }"],
    ["count", "count { it ${1:> 0} }"],
    ["sum", "sum()"],
    ["max", "max()"],
    ["min", "min()"],
    ["flatten", "flatten()"],
    ["take", "take(${1:n})"],
    ["drop", "drop(${1:n})"],
    ["takeWhile", "takeWhile { ${1:it < 10} }"],
    ["dropWhile", "dropWhile { ${1:it < 10} }"],
    ["collate", "collate(${1:size})"],
    ["combinations", "combinations()"],
    ["permutations", "permutations()"],
    ["eachWithIndex", "eachWithIndex { it, i -> ${1} }"],
    ["eachPermutation", "eachPermutation { ${1} }"],
    ["join", 'join("${1:,}")'],
    ["asSet", "toSet()"],
    ["indexed", "indexed()"],
  ] as const;

  const coll: Snippet[] = ops.map(([name, expr]) => ({
    trig: "col_" + name,
    body: "def ${1:r} = ${2:col}.${expr}${0}",
  }));

  const sops = [
    ["upper", "toUpperCase()"],
    ["lower", "toLowerCase()"],
    ["trim", "trim()"],
    ["split", 'split("${1:,}")'],
    ["replace", 'replaceAll(/${1:pattern}/, "${2:repl}")'],
    ["contains", 'contains("${1:sub}")'],
    ["pad", 'padRight(${1:len}, "${2: }")'],
    ["padL", 'padLeft(${1:len}, "${2: }")'],
    ["center", 'center(${1:len})'],
    ["interpolate", '"${1:Hello} ${2:name}"'],
  ] as const;

  const str: Snippet[] = sops.map(([name, expr]) => ({
    trig: "str_" + name,
    body: "def ${1:s} = ${2:src}.${expr}${0}",
  }));

  // Fichier / Réseau / Process / Date
  const sys: Snippet[] = [
    { trig: "proc", body: 'def p = "${1:cmd}".execute()\nprintln p.text${0}' },
    { trig: "date", body: 'def ${1:now} = new Date()\nprintln ${1:now}.format("${2:yyyy-MM-dd HH:mm:ss}")${0}' },
    { trig: "sleep", body: 'sleep ${1:1000}${0}' },
    { trig: "uuid", body: 'def ${1:id} = java.util.UUID.randomUUID().toString()${0}' },
    { trig: "path", body: 'def ${1:f} = new File(${2:path})${0}' },
    { trig: "mkdirs", body: 'new File(${1:path}).mkdirs()${0}' },
    { trig: "xmlp", body: 'def ${1:xml} = new XmlSlurper().parseText(${2:xmlString})${0}' },
    { trig: "xmls", body: 'def ${1:writer} = new StringWriter()\nnew groovy.xml.MarkupBuilder(${1:writer}).${2:root} {\n\t${3}\n}\n${0}' },
  ];

  // ===========
  // THREADS / CONCURRENCE
  // ===========
  const threads: Snippet[] = [
    // Thread de base (Groovy sugar)
    { trig: "t_start", body: 'def t = Thread.start { ${1:// travail en arrière-plan} }\n${0}' },
    // Thread nommé
    { trig: "t_startNamed", body: 'def t = new Thread({ ${1:// code} } as Runnable, "${2:Worker-1}")\nt.start()\n${0}' },
    // Join
    { trig: "t_join", body: '${1:t}.join(${2:0})${0}' },
    // Interrupt
    { trig: "t_interrupt", body: '${1:t}.interrupt()${0}' },
    // Courant
    { trig: "t_current", body: 'def th = Thread.currentThread()\nprintln th.name\n${0}' },
    // Sleep explicite Thread
    { trig: "t_sleep", body: 'Thread.sleep(${1:500})${0}' },
    // Vérifier interruption dans une boucle
    { trig: "t_checkInterrupted", body: 'while (!Thread.currentThread().isInterrupted()) {\n\t${1:// travail}\n}\n${0}' },

    // Synchronized
    { trig: "sync", body: 'synchronized(${1:lock}) {\n\t${2}\n}${0}' },

    // ReentrantLock
    { trig: "lock", body: 'def lock = new java.util.concurrent.locks.ReentrantLock()\nlock.lock()\ntry {\n\t${1}\n} finally {\n\tlock.unlock()\n}\n${0}' },

    // AtomicInteger
    { trig: "atomic", body: 'def ${1:ai} = new java.util.concurrent.atomic.AtomicInteger(${2:0})\n${1:ai}.incrementAndGet()${0}' },

    // CountDownLatch
    { trig: "latch", body: 'def latch = new java.util.concurrent.CountDownLatch(${1:2})\n// ... dans les workers: latch.countDown()\nlatch.await(${2:10}, java.util.concurrent.TimeUnit.SECONDS)${0}' },

    // Semaphore
    { trig: "semaphore", body: 'def sem = new java.util.concurrent.Semaphore(${1:1})\nsem.acquire()\ntry {\n\t${2}\n} finally {\n\tsem.release()\n}\n${0}' },

    // Executors - pool fixe
    { trig: "exec_fixed", body: 'def pool = java.util.concurrent.Executors.newFixedThreadPool(${1:4})\ntry {\n\t${2}\n} finally {\n\tpool.shutdown()\n}\n${0}' },

    // Submit Callable + Future.get avec timeout
    { trig: "exec_submit", body: 'def pool = java.util.concurrent.Executors.newFixedThreadPool(${1:4})\ntry {\n\tdef future = pool.submit({ ${2:return 42} } as java.util.concurrent.Callable)\n\tdef res = future.get(${3:5L}, java.util.concurrent.TimeUnit.SECONDS)\n\tprintln res\n} finally {\n\tpool.shutdown()\n}\n${0}' },

    // ScheduledExecutor
    { trig: "exec_sched", body: 'def sched = java.util.concurrent.Executors.newScheduledThreadPool(${1:1})\nsched.schedule({ ${2:println "run"} } as Runnable, ${3:1}, java.util.concurrent.TimeUnit.SECONDS)\n// sched.shutdown()\n${0}' },

    // invokeAll + collect des résultats
    { trig: "exec_invokeAll", body: 'def pool = java.util.concurrent.Executors.newFixedThreadPool(${1:4})\ntry {\n\tdef tasks = ${2:(1..5)}.collect { i -> { ${3:return i*i} } as java.util.concurrent.Callable }\n\tdef futures = pool.invokeAll(tasks)\n\tdef results = futures.collect { it.get() }\n\tprintln results\n} finally {\n\tpool.shutdown()\n}\n${0}' },

    // ConcurrentHashMap
    { trig: "conmap", body: 'def m = new java.util.concurrent.ConcurrentHashMap<${1:String}, ${2:Integer}>()\n${0}' },

    // ThreadLocal
    { trig: "threadLocal", body: 'def tl = new ThreadLocal<${1:String}>()\ntl.set(${2:"val"})\nprintln tl.get()\n${0}' },

    // [Optionnel] GPars parallel map (nécessite la dépendance GPars)
    { trig: "gpars_map", body: '@Grab("org.codehaus.gpars:gpars:${1:1.2.1}")\nimport static groovyx.gpars.GParsPool.withPool\nwithPool(${2:4}) {\n\tdef out = ${3:items}.parallel.map { ${4:it} }\n\tprintln out\n}\n${0}' }
  ];

  let all: Snippet[] = [...core, ...coll, ...str, ...sys, ...threads];

  const file = all.map(toSnippetText).join("\n");
  snippetManager.register(snippetManager.parseSnippetFile(file), "groovy");
}
