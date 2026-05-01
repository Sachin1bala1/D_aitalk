import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { DbClient } from "../db/DbClient";
import type { ConnectionConfig, FullSchema } from "../db/DbClient";
import { loadSavedConnectionsAsync } from "../db/ConnectionStore";

interface UseWorkspaceConnectionRuntimeOptions {
  connections: ConnectionConfig[];
  schemas: Record<string, FullSchema>;
  activeTabId: string;
  addConnection: (config: ConnectionConfig) => void;
  setSchema: (connectionId: string, schema: FullSchema) => void;
  setConnectionHealth: (
    connectionId: string,
    status: "healthy" | "error" | "checking",
  ) => void;
  setActiveConnection: (id: string | null) => void;
  updateTab: (tabId: string, updates: { connectionId?: string | null }) => void;
}

function fingerprintSchema(schema: FullSchema | undefined): string {
  if (!schema) return "";
  return schema.tables
    .map((table) => `${table.schema}.${table.name}`)
    .sort()
    .join("|");
}

export function useWorkspaceConnectionRuntime({
  connections,
  schemas,
  activeTabId,
  addConnection,
  setSchema,
  setConnectionHealth,
  setActiveConnection,
  updateTab,
}: UseWorkspaceConnectionRuntimeOptions) {
  const schemaFingerprintRef = useRef<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;

    const restoreSavedConnections = async () => {
      const saved = await loadSavedConnectionsAsync();
      if (saved.length === 0 || cancelled) return;

      let firstRestoredId: string | null = null;

      await Promise.allSettled(
        saved.map(async (config) => {
          try {
            const sanitized = await DbClient.connect(config);
            if (cancelled) return;

            addConnection(sanitized);
            const schema = await DbClient.getSchema(sanitized.id);
            if (cancelled) return;

            setSchema(sanitized.id, schema);
            setConnectionHealth(sanitized.id, "healthy");
            if (!firstRestoredId) firstRestoredId = sanitized.id;
          } catch {
            // Individual failure is non-fatal.
          }
        }),
      );

      if (cancelled || !firstRestoredId) return;

      setActiveConnection(firstRestoredId);
      updateTab(activeTabId, { connectionId: firstRestoredId });
      toast.success(
        saved.length === 1
          ? `Reconnected to ${saved[0].display_name}`
          : `Restored ${saved.length} connection(s)`,
      );
    };

    restoreSavedConnections();
    return () => {
      cancelled = true;
    };
  }, [activeTabId, addConnection, setActiveConnection, setConnectionHealth, setSchema, updateTab]);

  useEffect(() => {
    if (connections.length === 0) return;

    let cancelled = false;

    for (const connection of connections) {
      const schema = schemas[connection.id];
      if (schema) {
        schemaFingerprintRef.current[connection.id] = fingerprintSchema(schema);
      }
    }

    const check = async () => {
      for (const connection of connections) {
        try {
          const fresh = await DbClient.getSchema(connection.id);
          if (cancelled) return;

          const previous = schemaFingerprintRef.current[connection.id];
          const next = fingerprintSchema(fresh);
          if (previous !== undefined && previous !== next) {
            setSchema(connection.id, fresh);
            toast.info(`Schema changed on ${connection.display_name} - refreshed`, {
              description: "Another session may have run DDL. Schema sidebar updated.",
              duration: 6000,
            });
          }
          schemaFingerprintRef.current[connection.id] = next;
        } catch {
          // Ignore; health ping covers status.
        }
      }
    };

    const intervalId = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [connections, schemas, setSchema]);

  useEffect(() => {
    if (connections.length === 0) return;

    let cancelled = false;

    const pingConnections = async () => {
      for (const connection of connections) {
        if (cancelled) return;
        setConnectionHealth(connection.id, "checking");
        try {
          await DbClient.ping(connection.id);
          if (!cancelled) {
            setConnectionHealth(connection.id, "healthy");
          }
        } catch {
          if (!cancelled) {
            setConnectionHealth(connection.id, "error");
          }
        }
      }
    };

    pingConnections();
    const intervalId = setInterval(pingConnections, 30_000);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [connections, setConnectionHealth]);
}
