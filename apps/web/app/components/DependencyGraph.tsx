import React, { useMemo, useEffect } from 'react';
import { ReactFlow, Background, Controls, Node, Edge, MarkerType, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type DependencyGraphProps = {
  files: Array<{ path: string; metrics: { frictionScore: number } }>;
  dependencies: Array<{ source: string; dependencies: string[] }>;
  selectedFilePath: string;
  onSelectFile: (path: string) => void;
};

const scoreToneHex = (score: number) => {
  if (score >= 70) return '#f43f5e';
  if (score >= 35) return '#f59e0b';
  return '#10b981';
};

const NODE_LIMIT = 50;

import { Panel } from '@xyflow/react';

function GraphInner({ files, dependencies, selectedFilePath, onSelectFile }: DependencyGraphProps) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (!selectedFilePath) return { nodes: [], edges: [] };

    // Find incoming (dependents) and outgoing (dependencies)
    let incoming: string[] = [];
    let outgoing: string[] = [];

    dependencies.forEach(dep => {
      if (dep.source === selectedFilePath) {
        outgoing.push(...dep.dependencies);
      } else if (dep.dependencies.includes(selectedFilePath)) {
        incoming.push(dep.source);
      }
    });

    const getScore = (path: string) => files.find(f => f.path === path)?.metrics?.frictionScore ?? 0;
    
    // Sort safely with fallback to path comparison
    const sortNodes = (a: string, b: string) => {
      const diff = getScore(b) - getScore(a);
      return diff !== 0 ? diff : a.localeCompare(b);
    };

    incoming.sort(sortNodes);
    outgoing.sort(sortNodes);

    const LIMIT = 12;
    const incomingSliced = incoming.slice(0, LIMIT);
    const outgoingSliced = outgoing.slice(0, LIMIT);

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    // Center Node
    const centerScore = getScore(selectedFilePath);
    newNodes.push({
      id: selectedFilePath,
      position: { x: 0, y: 0 },
      data: {
        label: (
          <div className="flex flex-col items-center justify-center p-2">
            <span className="font-semibold text-slate-100 max-w-[200px] truncate" title={selectedFilePath}>{selectedFilePath.split('/').pop()}</span>
            <span className="text-xs font-mono mt-1" style={{ color: scoreToneHex(centerScore) }}>Score: {Math.round(centerScore)}</span>
          </div>
        )
      },
      style: {
        background: '#0f172a',
        border: `3px solid ${scoreToneHex(centerScore)}`,
        borderRadius: '8px',
        boxShadow: `0 0 20px ${scoreToneHex(centerScore)}`,
        minWidth: 150,
      }
    });

    // Helper for adding nodes/edges
    const addSideNodes = (list: string[], isIncoming: boolean, total: number) => {
      const xOffset = isIncoming ? -350 : 350;
      const ySpacing = 70;
      const startY = -((list.length - 1) * ySpacing) / 2;

      list.forEach((path, i) => {
        const score = getScore(path);
        newNodes.push({
          id: path,
          position: { x: xOffset, y: startY + i * ySpacing },
          data: {
            label: (
              <div className="flex flex-col items-center p-1">
                <span className="text-sm text-slate-200 max-w-[150px] truncate" title={path}>{path.split('/').pop()}</span>
                <span className="text-[10px]" style={{ color: scoreToneHex(score) }}>Score: {Math.round(score)}</span>
              </div>
            )
          },
          style: {
            background: '#1e293b',
            border: `2px solid ${scoreToneHex(score)}`,
            borderRadius: '6px'
          }
        });

        newEdges.push({
          id: isIncoming ? `${path}->${selectedFilePath}` : `${selectedFilePath}->${path}`,
          source: isIncoming ? path : selectedFilePath,
          target: isIncoming ? selectedFilePath : path,
          animated: true,
          markerEnd: { type: MarkerType.ArrowClosed, width: 15, height: 15, color: '#38bdf8' },
          style: { stroke: '#38bdf8', strokeWidth: 2 }
        });
      });

      // Omission node
      if (total > LIMIT) {
        newNodes.push({
          id: isIncoming ? 'more-incoming' : 'more-outgoing',
          position: { x: xOffset, y: startY + list.length * ySpacing },
          data: { label: `+${total - LIMIT} more` },
          style: { background: '#334155', color: '#94a3b8', border: '1px dashed #64748b', fontSize: '12px', padding: '4px' },
          selectable: false
        });
      }
    };

    addSideNodes(incomingSliced, true, incoming.length);
    addSideNodes(outgoingSliced, false, outgoing.length);

    return { nodes: newNodes, edges: newEdges };
  }, [files, dependencies, selectedFilePath]);

  useEffect(() => {
    if (nodes.length > 0) {
      requestAnimationFrame(() => fitView({ duration: 600, padding: 0.2 }));
    }
  }, [selectedFilePath, nodes.length, fitView]);

  if (!selectedFilePath) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-900">
        <p className="text-slate-400">Select a file from the dashboard to view its dependency blast radius.</p>
      </div>
    );
  }

  if (nodes.length === 1) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-900">
        <p className="text-slate-400">This file has no local dependencies or dependents.</p>
      </div>
    );
  }

  return (
    <ReactFlow 
      nodes={nodes} 
      edges={edges} 
      onNodeClick={(_, node) => {
        if (!node.id.startsWith('more-')) onSelectFile(node.id);
      }}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      nodesConnectable={false}
      nodesDraggable={true}
      elementsSelectable={true}
    >
      <Background color="#334155" />
      <Controls className="bg-slate-800 border-slate-700 fill-slate-300" showInteractive={false} />
      <Panel position="top-right" className="bg-slate-900/90 p-3 rounded border border-slate-700 text-xs text-slate-300">
        <p className="font-semibold mb-2">Legend</p>
        <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 rounded-full bg-emerald-500" /> Low Risk (0-34)</div>
        <div className="flex items-center gap-2 mb-1"><div className="w-3 h-3 rounded-full bg-amber-500" /> Medium Risk (35-69)</div>
        <div className="flex items-center gap-2 mb-2"><div className="w-3 h-3 rounded-full bg-rose-500" /> High Risk (70-100)</div>
        <p className="text-slate-400">Incoming: Files depending on this</p>
        <p className="text-slate-400">Outgoing: Files this depends on</p>
      </Panel>
    </ReactFlow>
  );
}

export function DependencyGraph(props: DependencyGraphProps) {
  return (
    <div style={{ width: '100%', height: '500px' }} className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <ReactFlowProvider>
        <GraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
