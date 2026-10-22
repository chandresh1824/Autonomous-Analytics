import { useMemo } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import type { SeriesSpec, TableData, VisualizationSpec } from '@/types/api';
import { aggregateByDimension, CHART_COLOR_HEX, pivotForGrouping, resolveAxes } from '@/utils/chartData';
import { KpiCards } from '@/components/chat/KpiCards';
import { formatCellValue, titleCase } from '@/utils/format';

interface ChartRendererProps {
  visualization: VisualizationSpec | null;
  table: TableData | null;
}

const CHART_HEIGHT = 320;
const AXIS_TICK_STYLE = { fontSize: 12, fill: 'var(--color-text-muted)' };
const TOOLTIP_STYLE = {
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 8,
  fontSize: 13,
  boxShadow: 'var(--shadow-md)',
};
const MARGIN = { top: 16, right: 16, left: 0, bottom: 8 };
const color = (idx: number) => CHART_COLOR_HEX[idx % CHART_COLOR_HEX.length];
const tooltipFormatter = (v: unknown) => formatCellValue(v);

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A time-bucket value (always the bucket's first day) named for its unit:
 * Week/Day "27 Oct 2025", Month "Oct 2025", Quarter "Q4 2025", Year "2025".
 * Anything that isn't a date is returned unchanged. */
function formatAxisValue(column: string, value: unknown): string {
  const m = typeof value === 'string' ? ISO_DATE_RE.exec(value) : null;
  if (!m) return formatCellValue(value);
  const [, year, month, day] = m;
  const monthName = MONTHS[Number(month) - 1];
  switch (column.toLowerCase()) {
    case 'year':
      return year;
    case 'quarter':
      return `Q${Math.floor((Number(month) - 1) / 3) + 1} ${year}`;
    case 'month':
      return `${monthName} ${year}`;
    default:
      return `${Number(day)} ${monthName} ${year}`;
  }
}

function renderPieLabel({ x, y, textAnchor, name, value }: PieLabelRenderProps) {
  return (
    <text
      x={x}
      y={y}
      textAnchor={textAnchor as 'start' | 'middle' | 'end'}
      dominantBaseline="central"
      fill="var(--color-text-secondary)"
      fontSize={12}
    >
      {`${name}: ${formatCellValue(value)}`}
    </text>
  );
}

export function ChartRenderer({ visualization, table }: ChartRendererProps) {
  if (!table || !visualization || visualization.type === 'table') {
    // The Data section already shows the rows - no second copy here.
    return null;
  }
  if (visualization.type === 'kpi_card') {
    return <KpiCards table={table} />;
  }

  const charts = visualization.type === 'multi_chart' ? visualization.charts ?? [] : [visualization];
  if (!charts.length) return null;
  const single = charts.length === 1;

  return (
    <div className={single ? 'chart-single' : 'multi-chart-grid'}>
      {charts.map((chart, idx) => (
        <figure className={single ? 'chart-item' : 'multi-chart-item'} key={`${chart.type}-${chart.x_axis ?? ''}-${idx}`}>
          {(!single || chart.description) && (
            <figcaption className="chart-caption">
              {!single && <span className="multi-chart-item-title">{chart.title || titleCase(chart.x_axis ?? '')}</span>}
              {chart.description && <span className="chart-description">{chart.description}</span>}
            </figcaption>
          )}
          {chart.type === 'kpi_card' ? <KpiCards table={table} /> : <SingleChart visualization={chart} table={table} />}
        </figure>
      ))}
    </div>
  );
}

/** Rows ready to plot for one chart: when the x_axis repeats across rows (a
 * result grouped by several columns, charted by one of them) and nothing
 * splits it into series, each measure is summed per x value. */
function useChartTable(spec: VisualizationSpec, table: TableData, x: string | null, fields: string[]): TableData {
  return useMemo(() => {
    if (!x || spec.group_by || spec.type === 'scatter') return table;
    const distinct = new Set(table.rows.map((r) => String(r[x])));
    if (distinct.size === table.rows.length) return table;
    return aggregateByDimension(table, x, fields);
  }, [spec, table, x, fields]);
}

function SingleChart({ visualization, table }: { visualization: VisualizationSpec; table: TableData }) {
  const { x, y } = useMemo(() => resolveAxes(visualization, table), [visualization, table]);
  const series = useMemo<SeriesSpec[]>(() => {
    const valid = visualization.series.filter((s) => table.columns.includes(s.field) && s.field !== x);
    return valid.length ? valid : y ? [{ field: y, label: titleCase(y) }] : [];
  }, [visualization.series, table.columns, x, y]);
  const fields = useMemo(() => series.map((s) => s.field), [series]);
  const data = useChartTable(visualization, table, x, fields);

  if (!x || !y || !series.length) return null;

  switch (visualization.type) {
    case 'scatter':
      return <ScatterVisualization table={data} x={x} y={y} />;
    case 'pie':
    case 'donut':
      return <PieVisualization table={data} x={x} y={y} donut={visualization.type === 'donut'} />;
    case 'radar':
      return <RadarVisualization table={data} x={x} series={series} />;
    case 'radial_bar':
      return <RadialBarVisualization table={data} x={x} y={y} />;
    case 'funnel':
      return <FunnelVisualization table={data} x={x} y={y} />;
    case 'treemap':
      return <TreemapVisualization table={data} x={x} y={y} />;
    case 'heatmap':
      return visualization.group_by && table.columns.includes(visualization.group_by) ? (
        <MatrixHeatmap table={data} x={x} y={y} groupBy={visualization.group_by} />
      ) : (
        <StripHeatmap table={data} x={x} y={y} />
      );
    default:
      return <CartesianVisualization spec={visualization} table={data} x={x} y={y} series={series} />;
  }
}

type Render = 'bar' | 'line' | 'area';

interface PlotSeries {
  key: string;
  label: string;
  render: Render;
  axis: 'left' | 'right';
  stackId?: string;
}

function baseRender(type: VisualizationSpec['type']): Render {
  if (type === 'line') return 'line';
  if (type === 'area' || type === 'stacked_area') return 'area';
  return 'bar';
}

/** Every bar/line/area family chart - including combos, stacking, group_by
 * splits, two value axes and horizontal bars - drawn on one ComposedChart. */
function CartesianVisualization({
  spec,
  table,
  x,
  y,
  series,
}: {
  spec: VisualizationSpec;
  table: TableData;
  x: string;
  y: string;
  series: SeriesSpec[];
}) {
  const groupBy = spec.group_by && table.columns.includes(spec.group_by) ? spec.group_by : null;
  const stacked = spec.type === 'stacked_bar' || spec.type === 'stacked_area';
  const horizontal = spec.type === 'horizontal_bar';

  const { rows, plot } = useMemo(() => {
    if (groupBy) {
      const pivoted = pivotForGrouping(table, x, y, groupBy);
      const plotSeries: PlotSeries[] = pivoted.groupKeys.map((key) => ({
        key,
        label: key,
        render: baseRender(spec.type),
        axis: 'left',
        stackId: stacked ? 'stack' : undefined,
      }));
      return { rows: pivoted.data, plot: plotSeries };
    }
    const plotSeries: PlotSeries[] = series.map((s, idx) => ({
      key: s.field,
      label: s.label || titleCase(s.field),
      render: spec.type === 'combo' ? s.render ?? (idx === 0 ? 'bar' : 'line') : baseRender(spec.type),
      axis: spec.type === 'combo' && s.axis === 'right' ? 'right' : 'left',
      stackId: stacked ? 'stack' : undefined,
    }));
    return { rows: table.rows, plot: plotSeries };
  }, [groupBy, table, x, y, series, spec.type, stacked]);

  const hasRightAxis = plot.some((p) => p.axis === 'right');
  const showLegend = plot.length > 1;
  // Value labels only where they stay readable.
  const labelBars = !stacked && plot.length <= 2 && rows.length <= 16;
  const tick = (v: unknown) => formatAxisValue(x, v);
  const height = horizontal ? Math.max(CHART_HEIGHT, rows.length * 28 + 40) : CHART_HEIGHT;

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <ComposedChart data={rows} layout={horizontal ? 'vertical' : 'horizontal'} margin={MARGIN}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
          {horizontal ? (
            <>
              <XAxis type="number" tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" />
              <YAxis type="category" dataKey={x} tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" width={140} tickFormatter={tick} />
            </>
          ) : (
            <>
              <XAxis dataKey={x} tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" tickMargin={8} tickFormatter={tick} />
              <YAxis yAxisId="left" tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" width={56} />
              {hasRightAxis && <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" width={56} />}
            </>
          )}
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} labelFormatter={tick} />
          {showLegend && <Legend wrapperStyle={{ fontSize: 13 }} />}
          {plot.map((p, idx) => {
            const common = { key: p.key, dataKey: p.key, name: p.label, ...(horizontal ? {} : { yAxisId: p.axis }) };
            if (p.render === 'line') {
              return (
                <Line {...common} type="monotone" stroke={color(idx)} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: color(idx) }} activeDot={{ r: 5 }} connectNulls />
              );
            }
            if (p.render === 'area') {
              return <Area {...common} type="monotone" stackId={p.stackId} stroke={color(idx)} strokeWidth={2} fill={color(idx)} fillOpacity={0.25} connectNulls />;
            }
            return (
              <Bar {...common} stackId={p.stackId} fill={color(idx)} radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} maxBarSize={48}>
                {/* A change column is negative for decreases - colour those bars apart. */}
                {plot.length === 1 && rows.some((r) => Number(r[p.key]) < 0) &&
                  rows.map((r, i) => <Cell key={i} fill={Number(r[p.key]) < 0 ? CHART_COLOR_HEX[7] : color(idx)} />)}
                {labelBars && (
                  <LabelList
                    dataKey={p.key}
                    position={horizontal ? 'right' : 'top'}
                    formatter={tooltipFormatter}
                    style={{ fill: 'var(--color-text-secondary)', fontSize: 12 }}
                  />
                )}
              </Bar>
            );
          })}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ScatterVisualization({ table, x, y }: { table: TableData; x: string; y: string }) {
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <ScatterChart margin={MARGIN}>
          <CartesianGrid stroke="var(--chart-grid)" />
          <XAxis type="number" dataKey={x} name={titleCase(x)} tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" />
          <YAxis type="number" dataKey={y} name={titleCase(y)} tick={AXIS_TICK_STYLE} stroke="var(--chart-axis)" width={56} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} cursor={{ strokeDasharray: '3 3' }} />
          <Scatter data={table.rows} fill={color(0)} />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function PieVisualization({ table, x, y, donut }: { table: TableData; x: string; y: string; donut: boolean }) {
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <PieChart margin={{ top: 24, right: 64, left: 64, bottom: 24 }}>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
          <Legend wrapperStyle={{ fontSize: 13 }} />
          <Pie
            data={table.rows}
            dataKey={y}
            nameKey={x}
            innerRadius={donut ? 64 : 0}
            outerRadius={95}
            paddingAngle={2}
            stroke="var(--color-surface)"
            strokeWidth={2}
            label={renderPieLabel}
            labelLine={{ stroke: 'var(--chart-axis)' }}
          >
            {table.rows.map((_, idx) => (
              <Cell key={idx} fill={color(idx)} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadarVisualization({ table, x, series }: { table: TableData; x: string; series: SeriesSpec[] }) {
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <RadarChart data={table.rows} outerRadius="72%">
          <PolarGrid stroke="var(--chart-grid)" />
          <PolarAngleAxis dataKey={x} tick={AXIS_TICK_STYLE} tickFormatter={(v) => formatAxisValue(x, v)} />
          <PolarRadiusAxis tick={AXIS_TICK_STYLE} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
          {series.length > 1 && <Legend wrapperStyle={{ fontSize: 13 }} />}
          {series.map((s, idx) => (
            <Radar key={s.field} dataKey={s.field} name={s.label || titleCase(s.field)} stroke={color(idx)} fill={color(idx)} fillOpacity={0.25} />
          ))}
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}

function RadialBarVisualization({ table, x, y }: { table: TableData; x: string; y: string }) {
  const data = useMemo(
    () => table.rows.map((r, idx) => ({ name: formatAxisValue(x, r[x]), value: Number(r[y]) || 0, fill: color(idx) })),
    [table, x, y],
  );
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <RadialBarChart data={data} innerRadius="20%" outerRadius="95%" startAngle={90} endAngle={-270}>
          <RadialBar dataKey="value" background label={{ position: 'insideStart', fill: '#fff', fontSize: 11 }} />
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
          <Legend wrapperStyle={{ fontSize: 13 }} layout="vertical" align="right" verticalAlign="middle" />
        </RadialBarChart>
      </ResponsiveContainer>
    </div>
  );
}

function FunnelVisualization({ table, x, y }: { table: TableData; x: string; y: string }) {
  const data = useMemo(
    () => table.rows.map((r, idx) => ({ name: formatAxisValue(x, r[x]), value: Number(r[y]) || 0, fill: color(idx) })),
    [table, x, y],
  );
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <FunnelChart>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
          <Funnel dataKey="value" nameKey="name" data={data} isAnimationActive>
            <LabelList position="right" dataKey="name" fill="var(--color-text-secondary)" stroke="none" fontSize={12} />
            <LabelList position="center" dataKey="value" fill="#fff" stroke="none" fontSize={12} formatter={tooltipFormatter} />
          </Funnel>
        </FunnelChart>
      </ResponsiveContainer>
    </div>
  );
}

interface TreemapCellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  name?: string;
  value?: number;
}

function TreemapCell({ x = 0, y = 0, width = 0, height = 0, index = 0, name, value }: TreemapCellProps) {
  const roomy = width > 70 && height > 34;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={color(index)} stroke="var(--color-surface)" strokeWidth={2} />
      {roomy && (
        <>
          <text x={x + 6} y={y + 16} fill="#fff" fontSize={12} fontWeight={600}>
            {name}
          </text>
          <text x={x + 6} y={y + 31} fill="#fff" fontSize={11}>
            {formatCellValue(value)}
          </text>
        </>
      )}
    </g>
  );
}

function TreemapVisualization({ table, x, y }: { table: TableData; x: string; y: string }) {
  const data = useMemo(
    () =>
      table.rows
        .map((r) => ({ name: formatAxisValue(x, r[x]), value: Number(r[y]) || 0 }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    [table, x, y],
  );
  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
        <Treemap data={data} dataKey="value" nameKey="name" isAnimationActive={false} content={<TreemapCell />}>
          <Tooltip contentStyle={TOOLTIP_STYLE} formatter={tooltipFormatter} />
        </Treemap>
      </ResponsiveContainer>
    </div>
  );
}

const HEATMAP_BASE_RGB = '42, 120, 214'; // matches CHART_COLOR_HEX[0]

function heatStyle(value: number, min: number, max: number) {
  // 0.12-0.92: the lowest value stays visibly tinted, the highest never
  // goes fully opaque, so cell text stays legible.
  const intensity = 0.12 + ((value - min) / (max - min || 1)) * 0.8;
  return { background: `rgba(${HEATMAP_BASE_RGB}, ${intensity.toFixed(2)})`, color: intensity > 0.45 ? '#fff' : 'var(--color-text)' };
}

function numericRange(values: number[]) {
  const finite = values.filter((v) => Number.isFinite(v));
  return { min: Math.min(...finite, 0), max: Math.max(...finite, 0) };
}

/** One category with many values: one shaded cell per value. */
function StripHeatmap({ table, x, y }: { table: TableData; x: string; y: string }) {
  const { min, max } = useMemo(() => numericRange(table.rows.map((r) => Number(r[y]))), [table, y]);
  return (
    <div className="chart-frame">
      <div className="heatmap-grid">
        {table.rows.map((row, idx) => {
          const value = Number(row[y]) || 0;
          const label = formatAxisValue(x, row[x]);
          return (
            <div key={idx} className="heatmap-cell" style={heatStyle(value, min, max)} title={`${label}: ${formatCellValue(value)}`}>
              <span className="heatmap-cell-value">{formatCellValue(value)}</span>
              <span className="heatmap-cell-label">{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** One measure across two categories: x_axis as columns, group_by as rows. */
function MatrixHeatmap({ table, x, y, groupBy }: { table: TableData; x: string; y: string; groupBy: string }) {
  const { columns, rowKeys, cells, min, max } = useMemo(() => {
    const cols: string[] = [];
    const rowsOrder: string[] = [];
    const map = new Map<string, number>();
    for (const r of table.rows) {
      const c = String(r[x] ?? '(blank)');
      const g = String(r[groupBy] ?? '(blank)');
      if (!cols.includes(c)) cols.push(c);
      if (!rowsOrder.includes(g)) rowsOrder.push(g);
      map.set(`${g}\u0000${c}`, (map.get(`${g}\u0000${c}`) ?? 0) + (Number(r[y]) || 0));
    }
    return { columns: cols, rowKeys: rowsOrder, cells: map, ...numericRange([...map.values()]) };
  }, [table, x, y, groupBy]);

  return (
    <div className="chart-frame heatmap-matrix-frame">
      <table className="heatmap-matrix">
        <thead>
          <tr>
            <th>{titleCase(groupBy)}</th>
            {columns.map((c) => (
              <th key={c}>{formatAxisValue(x, c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rowKeys.map((g) => (
            <tr key={g}>
              <th>{g}</th>
              {columns.map((c) => {
                const value = cells.get(`${g}\u0000${c}`);
                return value === undefined ? (
                  <td key={c} className="heatmap-matrix-empty">–</td>
                ) : (
                  <td key={c} style={heatStyle(value, min, max)} title={`${g} · ${formatAxisValue(x, c)}: ${formatCellValue(value)}`}>
                    {formatCellValue(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
