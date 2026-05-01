import { useCallback } from "react";
import { toast } from "sonner";
import { DbClient } from "../db/DbClient";
import type { ConnectionConfig, FullSchema } from "../db/DbClient";
import {
  persistConnections,
  removeConnection as removePersistedConnection,
} from "../db/ConnectionStore";

interface UseWorkspaceConnectionActionsOptions {
  activeTabId: string;
  connections: ConnectionConfig[];
  addConnection: (config: ConnectionConfig) => void;
  removeConnection: (id: string) => void;
  setSchema: (connectionId: string, schema: FullSchema) => void;
  setActiveConnection: (id: string | null) => void;
  updateTab: (tabId: string, updates: { connectionId?: string | null }) => void;
  onConnected?: () => void;
}

export function useWorkspaceConnectionActions({
  activeTabId,
  connections,
  addConnection,
  removeConnection,
  setSchema,
  setActiveConnection,
  updateTab,
  onConnected,
}: UseWorkspaceConnectionActionsOptions) {
  const refreshSchema = useCallback(async (connectionId: string) => {
    try {
      const schema = await DbClient.getSchema(connectionId);
      setSchema(connectionId, schema);
    } catch (error: any) {
      toast.error(`Schema refresh failed: ${error?.message ?? "Unknown error"}`);
    }
  }, [setSchema]);

  const handleConnect = useCallback(async (connectionId: string, config?: ConnectionConfig) => {
    setActiveConnection(connectionId);
    await refreshSchema(connectionId);
    updateTab(activeTabId, { connectionId });
    onConnected?.();

    if (config) {
      addConnection(config);
      const nextConnections = [
        ...connections.filter((connection) => connection.id !== config.id),
        config,
      ];
      persistConnections(nextConnections).catch(() => {});
    }

    toast.success("Connected");
  }, [activeTabId, addConnection, connections, onConnected, refreshSchema, setActiveConnection, updateTab]);

  const handleDisconnect = useCallback(async (connectionId: string) => {
    try {
      await DbClient.disconnect(connectionId);
    } catch {
      // Ignore disconnect failures; remove locally either way.
    }

    removeConnection(connectionId);
    removePersistedConnection(connectionId);
    const nextConnections = connections.filter((connection) => connection.id !== connectionId);
    persistConnections(nextConnections).catch(() => {});
    toast.info("Disconnected");
  }, [connections, removeConnection]);

  return {
    refreshSchema,
    handleConnect,
    handleDisconnect,
  };
}
