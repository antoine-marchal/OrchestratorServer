import { useEffect } from "react";
import * as ace from "ace-builds/src-noconflict/ace";


import "ace-builds/src-noconflict/ext-language_tools";
import "ace-builds/src-noconflict/snippets/javascript";
import "ace-builds/src-noconflict/snippets/groovy";

import { registerGroovySnippets } from "./groovySnippets";
import { registerJSSnippets } from "./jsSnippets";
import { registerBatchSnippets,registerPowershellSnippets } from "./bashPowershellSnippets";
type Props = { children?: React.ReactNode };


export default function SnippetsProvider({ children }: Props) {
  useEffect(() => {
    const { snippetManager } = (ace as any).require("ace/snippets");
    if (!snippetManager) return;


    registerGroovySnippets(snippetManager);
    registerJSSnippets(snippetManager);
    registerBatchSnippets(snippetManager);
    registerPowershellSnippets(snippetManager);
  }, []);

  return <>{children}</>;
}
