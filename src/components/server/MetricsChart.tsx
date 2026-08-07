import { useTranslation } from "react-i18next";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { Cpu, MemoryStick } from "lucide-react";
import type { ProcessMetrics } from "@/lib/types";

interface MetricsChartProps {
  data: ProcessMetrics[];
}

export function MetricsChart({ data }: MetricsChartProps) {
  const { t } = useTranslation();

  const latestMetrics = data.length > 0 ? data[data.length - 1] : null;

  if (!latestMetrics) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        {t('server.noMetrics')}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* CPU Chart */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Cpu className="h-3 w-3" />
            <span>{t('server.cpu')}</span>
          </div>
          <span className="text-sm font-mono font-medium">
            {latestMetrics.cpu_usage.toFixed(1)}%
          </span>
        </div>
        <div className="h-12 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <YAxis domain={[0, 'auto']} hide />
              <Line
                type="monotone"
                dataKey="cpu_usage"
                stroke="hsl(var(--primary))"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Memory Chart */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <MemoryStick className="h-3 w-3" />
            <span>{t('server.memory')}</span>
          </div>
          <span className="text-sm font-mono font-medium">
            {latestMetrics.memory_mb >= 1024
              ? `${(latestMetrics.memory_mb / 1024).toFixed(2)} GB`
              : `${latestMetrics.memory_mb.toFixed(0)} MB`
            }
          </span>
        </div>
        <div className="h-12 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <YAxis domain={[0, 'auto']} hide />
              <Line
                type="monotone"
                dataKey="memory_mb"
                stroke="hsl(142, 76%, 36%)"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
