import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useReactFlow,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { MapState } from "../state/types";
import { CardNode, type CardFlowNode } from "./CardNode";
import { buildEdges, buildNodes, depthOf, isInside, sizeParents } from "./flow";

const nodeTypes = { card: CardNode };

export interface MapActions {
  move: (id: string, x: number, y: number) => void;
  nest: (child: string, parent: string) => void;
  /** Take a card out of its parent, leaving it where it was dropped (canvas position). */
  takeOutAt: (id: string, x: number, y: number) => void;
  takeOut: (id: string) => void;
  edit: (id: string, text: string) => void;
  remove: (id: string) => void;
  link: (from: string, to: string) => void;
  relabel: (linkId: string) => void;
  unlink: (linkId: string) => void;
}

interface Props {
  map: MapState;
  readOnly: boolean;
  editId: string | null;
  setEditId: (id: string | null) => void;
  actions: MapActions;
}

/**
 * The map canvas (spec §8). Only accepted cards and links are here; pending proposals
 * stay in the chat. Every change goes through the `state/map.ts` functions via `actions`.
 */
export function MapView({ map, readOnly, editId, setEditId, actions }: Props) {
  const flow = useReactFlow();
  const [nodes, setNodes] = useState<CardFlowNode[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

  const callbacks = useMemo(
    () => ({
      readOnly,
      onStartEdit: (id: string) => setEditId(id),
      onFinishEdit: (id: string, text: string | null) => {
        setEditId(null);
        if (text !== null) actions.edit(id, text);
      },
      onDelete: actions.remove,
      onTakeOut: actions.takeOut,
    }),
    [readOnly, setEditId, actions],
  );

  // Effects must return nothing or a cleanup, so no braceless arrows here (see 3b3a0e0).
  useEffect(() => {
    setNodes((prev) => buildNodes(map, prev, editId, callbacks));
  }, [map, editId, callbacks]);
  useEffect(() => {
    setEdges((prev) => buildEdges(map, prev));
  }, [map]);

  // Measurements and drag positions live here until a drag ends; then the map is updated.
  const onNodesChange = useCallback((changes: NodeChange<CardFlowNode>[]) => {
    setNodes((nds) => sizeParents(applyNodeChanges(changes.filter((c) => c.type !== "remove"), nds)));
  }, []);
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setEdges((eds) => applyEdgeChanges(changes.filter((c) => c.type !== "remove"), eds));
  }, []);

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      const dragged = flow.getInternalNode(node.id);
      const card = map.cards.find((c) => c.id === node.id);
      if (!dragged || !card) return;
      const abs = dragged.internals.positionAbsolute;
      const w = dragged.measured.width ?? 0;
      const h = dragged.measured.height ?? 0;
      const center = { x: abs.x + w / 2, y: abs.y + h / 2 };

      // The innermost card the dropped card's centre lands on (not itself or its own children).
      let target: { id: string; depth: number } | undefined;
      for (const other of map.cards) {
        if (other.id === node.id || isInside(map, other.id, node.id)) continue;
        const n = flow.getInternalNode(other.id);
        if (!n) continue;
        const p = n.internals.positionAbsolute;
        const ow = n.measured.width ?? 0;
        const oh = n.measured.height ?? 0;
        const hit = center.x >= p.x && center.x <= p.x + ow && center.y >= p.y && center.y <= p.y + oh;
        const depth = depthOf(map, other.id);
        if (hit && (!target || depth > target.depth)) target = { id: other.id, depth };
      }

      if (target && target.id !== card.parentId) actions.nest(node.id, target.id);
      else if (!target && card.parentId) actions.takeOutAt(node.id, abs.x, abs.y);
      else actions.move(node.id, node.position.x, node.position.y);
    },
    [flow, map, actions],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onConnect={(c) => c.source && c.target && actions.link(c.source, c.target)}
      onEdgeDoubleClick={(_, edge) => !readOnly && actions.relabel(edge.id)}
      // Only links are deleted with the keyboard; a card's ✕ deletes it (and keeps its children).
      onBeforeDelete={async ({ edges: gone }) => {
        if (!readOnly) gone.forEach((e) => actions.unlink(e.id));
        return false;
      }}
      nodesDraggable={!readOnly}
      nodesConnectable={!readOnly}
      zoomOnDoubleClick={false}
      fitView
      // Don't blow a single card up to fill the screen.
      fitViewOptions={{ maxZoom: 1, padding: 0.3 }}
      minZoom={0.2}
    >
      <Background gap={20} size={1} />
      <Controls showInteractive={false} />
      <MiniMap pannable zoomable />
    </ReactFlow>
  );
}
