import React, { useMemo, useEffect } from 'react';
import { ReactFlow, Background, Controls, Node, Edge, useReactFlow, ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';

type CoChangeGraphProps = {
  files: Array<{ path: string; metrics: { frictionScore: number } }>;
  cochanges: Array<{ source: string; target: string; count: number }>;
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

function GraphInner({ files, cochanges, selectedFilePath, onSelectFile }: CoChangeGraphProps) {
  const { fitView } = useReactFlow();

  const { nodes, edges } = useMemo(() => {
    if (!selectedFilePath) return { nodes: [], edges: [] };

    const getScore = (path: string) => files.find(f => f.path === path)?.metrics?.frictionScore ?? 0;

    // Filter valid cochanges for selected file
    const neighbours = cochanges
      .filter(c => c.count >= 2 && (c.source === selectedFilePath || c.target === selectedFilePath))
      .map(c => ({
        path: c.source === selectedFilePath ? c.target : c.source,
        count: c.count
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const diff = getScore(b.path) - getScore(a.path);
        return diff !== 0 ? diff : a.path.localeCompare(b.path);
      });

    const LIMIT = 12;
    const neighboursSliced = neighbours.slice(0, LIMIT);

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

    const radius = 250;
    const angleStep = (2 * Math.PI) / (neighboursSliced.length || 1);

    neighboursSliced.forEach((n, i) => {
      const score = getScore(n.path);
      const px = radius * Math.cos(i * angleStep - Math.PI / 2);
      const py = radius * Math.sin(i * angleStep - Math.PI / 2);

      newNodes.push({
        id: n.path,
        position: { x: px, y: py },
        data: {
          label: (
            <div className="flex flex-col items-center p-1">
              <span className="text-sm text-slate-200 max-w-[150px] truncate" title={n.path}>{n.path.split('/').pop()}</span>
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
        id: `${selectedFilePath}-${n.path}`,
        source: selectedFilePath,
        target: n.path,
        label: `${n.count} commits`,
        labelBgPadding: [8, 4],
        labelBgBorderRadius: 4,
        labelBgStyle: { fill: '#1e293b', color: '#f8fafc', fillOpacity: 0.9, stroke: '#334155', strokeWidth: 1 },
        labelStyle: { fill: '#f8fafc', fontWeight: 500, fontSize: 11 },
        style: {
          stroke: '#c084fc',
          strokeWidth: Math.min(n.count, 10),
          opacity: 0.8,
        }
      });
    });

    // Omission node
    if (neighbours.length > LIMIT) {
      newNodes.push({
        id: 'more-cochange',
        position: { x: radius * Math.cos(-Math.PI / 4), y: radius * Math.sin(-Math.PI / 4) + 60 },
        data: { label: `+${neighbours.length - LIMIT} more` },
        style: { background: '#334155', color: '#94a3b8', border: '1px dashed #64748b', fontSize: '12px', padding: '4px' },
        selectable: false
      });
    }

    return { nodes: newNodes, edges: newEdges };
  }, [files, cochanges, selectedFilePath]);

  useEffect(() => {
    if (nodes.length > 0) {
      requestAnimationFrame(() => fitView({ duration: 600, padding: 0.3 }));
    }
  }, [selectedFilePath, nodes.length, fitView]);

  if (!selectedFilePath) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-900">
        <p className="text-slate-400">Select a file from the dashboard to view its co-change relationships.</p>
      </div>
    );
  }

  if (nodes.length === 1) {
    return (
      <div className="flex h-[500px] w-full items-center justify-center rounded-lg border border-slate-800 bg-slate-900">
        <p className="text-slate-400">This file has no significant co-change relationships.</p>
      </div>
    );
  }

  return (
    <ReactFlow 
      nodes={nodes} 
      edges={edges} 
      onNodeClick={(_, node) => {
        if (node.id !== 'more-cochange') onSelectFile(node.id);
      }}
      fitView
      fitViewOptions={{ padding: 0.3 }}
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
        <p className="text-slate-400">Co-change: Files historically modified together</p>
        <p className="text-slate-400">Line thickness implies frequency</p>
      </Panel>
    </ReactFlow>
  );
}

export function CoChangeGraph(props: CoChangeGraphProps) {
  return (
    <div style={{ width: '100%', height: '500px' }} className="rounded-lg border border-slate-800 bg-slate-900 overflow-hidden">
      <ReactFlowProvider>
        <GraphInner {...props} />
      </ReactFlowProvider>
    </div>
  );
}
