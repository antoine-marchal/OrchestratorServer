import type { Node as XyNode, Edge as XyEdge } from '@xyflow/react';

/**
 * reactflow v11 typed `node.data` / `edge.data` as `any` by default; @xyflow/react v12
 * defaults to `Record<string, unknown>`. These aliases keep the v11 defaults so
 * existing call sites stay typed as before — pass a data type for stricter typing.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Node<T extends Record<string, unknown> = any, U extends string | undefined = string | undefined> = XyNode<T, U>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Edge<T extends Record<string, unknown> = any, U extends string | undefined = string | undefined> = XyEdge<T, U>;
