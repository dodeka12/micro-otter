// Copyright (c) 2025 Christian Perwass; SPDX-License-Identifier: GPL-3.0-only
import { debugLog } from '../core/debug.js';

class RenderWorkspace {
    constructor() {
        this.constants = {
            GRID_SPACING: 32,
            GRID_MAJOR_INTERVAL: 5,
            GRID_MINOR_COLOR: 'rgba(235, 238, 246, 0.12)',
            GRID_MAJOR_COLOR: 'rgba(235, 238, 246, 0.24)',
            NODE_FILL: '#51607c',
            NODE_STROKE: '#e8ebf7',
            NODE_SELECTED: '#f0d858',
            NODE_TEXT: '#f5f5f5',
            CONNECTOR_RADIUS: 7,
            TEMP_CONN_COLOR: 'rgba(240, 216, 88, 0.8)',
        };
    }

    #prepareContext(env) {
        if (!env) {
            return { ctx: null, width: 0, height: 0, readability: false };
        }
        const { ctx, canvas, readability } = env.getRenderContext();
        if (!ctx || !canvas) {
            return { ctx: null, width: 0, height: 0, readability: false };
        }
        const { width, height } = env.getSize();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        env.applyViewport(ctx);
        return { ctx, width, height, readability };
    }

    drawGrid(ctx, env, width, height) {
        const { GRID_SPACING, GRID_MAJOR_INTERVAL, GRID_MINOR_COLOR, GRID_MAJOR_COLOR } =
            this.constants;
        // Compute world-space bounds for the visible canvas so the grid fully
        // covers the current viewport (including panning/zooming).
        const topLeft = env.screenToWorld({ x: 0, y: 0 });
        const bottomRight = env.screenToWorld({ x: width, y: height });
        const minX = Math.min(topLeft.x, bottomRight.x);
        const maxX = Math.max(topLeft.x, bottomRight.x);
        const minY = Math.min(topLeft.y, bottomRight.y);
        const maxY = Math.max(topLeft.y, bottomRight.y);
        const startX = Math.floor(minX / GRID_SPACING) * GRID_SPACING - GRID_SPACING;
        const endX = Math.ceil(maxX / GRID_SPACING) * GRID_SPACING + GRID_SPACING;
        const startY = Math.floor(minY / GRID_SPACING) * GRID_SPACING - GRID_SPACING;
        const endY = Math.ceil(maxY / GRID_SPACING) * GRID_SPACING + GRID_SPACING;

        ctx.save();
        ctx.lineCap = 'butt';
        for (let x = startX, idx = 0; x <= endX; x += GRID_SPACING, idx += 1) {
            ctx.strokeStyle = idx % GRID_MAJOR_INTERVAL === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
            ctx.lineWidth = idx % GRID_MAJOR_INTERVAL === 0 ? 1.2 : 0.8;
            ctx.beginPath();
            ctx.moveTo(x, startY);
            ctx.lineTo(x, endY);
            ctx.stroke();
        }
        for (let y = startY, idx = 0; y <= endY; y += GRID_SPACING, idx += 1) {
            ctx.strokeStyle = idx % GRID_MAJOR_INTERVAL === 0 ? GRID_MAJOR_COLOR : GRID_MINOR_COLOR;
            ctx.lineWidth = idx % GRID_MAJOR_INTERVAL === 0 ? 1.2 : 0.8;
            ctx.beginPath();
            ctx.moveTo(startX, y);
            ctx.lineTo(endX, y);
            ctx.stroke();
        }
        ctx.restore();
    }

    drawConnections(ctx, graph) {
        const connections = graph?.getConnections?.() || [];
        const nodes = graph?.getNodes?.() || [];
        const nodeMap = new Map();
        nodes.forEach((node) => nodeMap.set(node.id, node));
        ctx.save();
        ctx.lineWidth = 2.5;
        connections.forEach((conn) => {
            const fromNode = nodeMap.get(conn.fromNode);
            const toNode = nodeMap.get(conn.toNode);
            if (!fromNode || !toNode) {
                return;
            }
            const fromX = (fromNode.x || 0) + (fromNode.width || 140);
            const fromY = (fromNode.y || 0) + (fromNode.height || 90) / 2;
            const toX = toNode.x || 0;
            const toY = (toNode.y || 0) + (toNode.height || 90) / 2;
            ctx.strokeStyle = '#95b89a';
            ctx.beginPath();
            ctx.moveTo(fromX, fromY);
            const cpOffset = Math.max(Math.abs(toX - fromX) * 0.35, 60);
            ctx.bezierCurveTo(fromX + cpOffset, fromY, toX - cpOffset, toY, toX, toY);
            ctx.stroke();
        });
        ctx.restore();
    }

    drawConnector(ctx, { x, y, kind, highlighted = false }) {
        const { CONNECTOR_RADIUS, TEMP_CONN_COLOR } = this.constants;
        ctx.save();
        const radius = CONNECTOR_RADIUS;
        if (kind === 'input') {
            ctx.strokeStyle = highlighted ? TEMP_CONN_COLOR : '#7ba3d6';
            ctx.fillStyle = highlighted ? TEMP_CONN_COLOR : '#d4d7e3';
            ctx.lineWidth = highlighted ? 3 : 2;
            ctx.beginPath();
            ctx.arc(x - radius, y, radius, -Math.PI * 0.5, Math.PI * 0.5);
            ctx.stroke();
            if (highlighted) {
                ctx.globalAlpha = 0.2;
                ctx.beginPath();
                ctx.arc(x - radius, y, radius + 4, 0, Math.PI * 2);
                ctx.fill();
            }
        } else {
            ctx.fillStyle = highlighted ? TEMP_CONN_COLOR : '#95b89a';
            ctx.strokeStyle = highlighted ? TEMP_CONN_COLOR : '#7da682';
            ctx.lineWidth = highlighted ? 2.5 : 1.5;
            const size = radius;
            ctx.beginPath();
            ctx.roundRect(x - size, y - size, size * 2, size * 2, 3);
            ctx.fill();
            ctx.stroke();
        }
        ctx.restore();
    }

    getConnectorPositions(node) {
        const x = node.x || 0;
        const y = node.y || 0;
        const w = node.width || 140;
        const h = node.height || 90;
        const centerY = y + h / 2;
        return {
            input: { x, y: centerY },
            output: { x: x + w, y: centerY },
        };
    }

    drawNodes(ctx, graph, { selectedNodeId = null, hoverConnector = null } = {}) {
        const { NODE_FILL, NODE_SELECTED, NODE_STROKE, NODE_TEXT } = this.constants;
        const nodes = graph?.getNodes?.() || [];
        ctx.save();
        ctx.font = '12px "Segoe UI", Arial, sans-serif';
        ctx.textBaseline = 'middle';
        nodes.forEach((node) => {
            const x = node.x || 0;
            const y = node.y || 0;
            const w = node.width || 140;
            const h = node.height || 90;
            ctx.fillStyle = NODE_FILL;
            ctx.strokeStyle = node.id === selectedNodeId ? NODE_SELECTED : NODE_STROKE;
            ctx.lineWidth = node.id === selectedNodeId ? 3 : 1.5;
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, 10);
            ctx.fill();
            ctx.stroke();
            const title = node.title || node.type || `Node ${node.id}`;
            ctx.fillStyle = NODE_TEXT;
            ctx.textAlign = 'center';
            ctx.fillText(title, x + w / 2, y + 18);

            const connectors = this.getConnectorPositions(node);
            this.drawConnector(ctx, {
                x: connectors.input.x,
                y: connectors.input.y,
                kind: 'input',
                highlighted:
                    hoverConnector &&
                    hoverConnector.kind === 'input' &&
                    hoverConnector.nodeId === node.id,
            });
            this.drawConnector(ctx, {
                x: connectors.output.x,
                y: connectors.output.y,
                kind: 'output',
                highlighted:
                    hoverConnector &&
                    hoverConnector.kind === 'output' &&
                    hoverConnector.nodeId === node.id,
            });
        });
        ctx.restore();
    }

    drawTempConnection(ctx, { start, end }) {
        const { TEMP_CONN_COLOR } = this.constants;
        if (!start || !end) {
            return;
        }
        ctx.save();
        ctx.strokeStyle = TEMP_CONN_COLOR;
        ctx.lineWidth = 2.5;
        ctx.shadowColor = 'rgba(240,216,88,0.4)';
        ctx.shadowBlur = 12;
        const dx = end.x - start.x;
        const cpOffset = Math.max(Math.abs(dx) * 0.35, 60);
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.bezierCurveTo(start.x + cpOffset, start.y, end.x - cpOffset, end.y, end.x, end.y);
        ctx.stroke();
        ctx.restore();
    }

    render({ env, workspace, selectedNodeId = null, overlay = null }) {
        if (!env || !workspace) {
            return;
        }
        const { ctx, width, height, readability } = this.#prepareContext(env);
        if (!ctx) {
            return;
        }
        const graph = workspace.getActiveGraph();
        this.drawGrid(ctx, env, width, height);
        if (!graph) {
            return;
        }
        this.drawConnections(ctx, graph);
        this.drawNodes(ctx, graph, {
            selectedNodeId,
            hoverConnector: overlay?.hoverConnector || null,
        });
        if (overlay?.tempConnection) {
            this.drawTempConnection(ctx, overlay.tempConnection);
        }

        // If we rendered to the readability canvas, blit to the visible canvas.
        if (readability && env?.ctx && env.readabilityCanvas) {
            env.ctx.setTransform(1, 0, 0, 1, 0, 0);
            env.ctx.clearRect(0, 0, env.canvas.width, env.canvas.height);
            env.ctx.drawImage(env.readabilityCanvas, 0, 0);
        }
    }
}

const renderWorkspaceSingleton = new RenderWorkspace();

export function renderWorkspace(args) {
    return renderWorkspaceSingleton.render(args);
}

export function getConnectorPositions(node) {
    return renderWorkspaceSingleton.getConnectorPositions(node);
}

export { RenderWorkspace, renderWorkspaceSingleton };
