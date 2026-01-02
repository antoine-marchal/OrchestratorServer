import {
  FileCode,
  Server,
  Coffee,
  Terminal,
  TerminalSquare,
  Hash,
  MessageSquare,
  GitBranch,
  CornerRightDown,
  Code2
} from 'lucide-react';
import { LucideIcon } from 'lucide-react';

export interface NodeTypeDefinition {
  id: string;
  label: string;
  code?: string;
  value?: string;
  icon: LucideIcon;
  iconColor: string;
}

export const NODE_TYPES: NodeTypeDefinition[] = [
  {
    id: 'javascript',
    label: 'JavaScript',
    code: 'console.log(\'Hello\')\nreturn input;\n',
    icon: FileCode,
    iconColor: 'text-yellow-500'
  },
  {
    id: 'jsbackend',
    label: 'Backend JS',
    code: `console.log('Received input:', input);

    const result = Array.isArray(input)
      ? input.map(x => x * 2)    // Doubles each item
      : [];

    output = result;`,
    icon: Server,
    iconColor: 'text-blue-500'
  },
  {
    id: 'groovy',
    label: 'Groovy',
    code: 'println "beginning processing with $input"\noutput= input',
    icon: Coffee,
    iconColor: 'text-red-500'
  },
  {
    id: 'batch',
    label: 'Batch',
    code: 'echo Hello %INPUT% > %OUTPUT%',
    icon: Terminal,
    iconColor: 'text-gray-400'
  },
  {
    id: 'powershell',
    label: 'PowerShell',
    code: 'Write-Output "Hello $env:INPUT"\nSet-Content -Path $env:OUTPUT -Value $env:INPUT',
    icon: TerminalSquare,
    iconColor: 'text-blue-400'
  },
  {
    id: 'python',
    label: 'Python',
    code: '# input contains the data from connected nodes\noutput = input\nprint(output)',
    icon: Code2,
    iconColor: 'text-yellow-500'
  },
  {
    id: 'variable',
    label: 'Variable',
    value: '0',
    icon: Hash,
    iconColor: 'text-purple-500'
  },
  {
    id: 'comment',
    label: 'Comment',
    value: '',
    icon: MessageSquare,
    iconColor: 'text-gray-500'
  },
  {
    id: 'flow',
    label: 'Flow',
    code: '',
    icon: GitBranch,
    iconColor: 'text-emerald-500'
  },
  {
    id: 'goto',
    label: 'Goto',
    icon: CornerRightDown,
    iconColor: 'text-yellow-400',
  }
];
