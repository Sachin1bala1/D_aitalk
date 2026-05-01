import { useCallback } from "react";
import { toast } from "sonner";
import { DbClient } from "../db/DbClient";

interface UseWorkspaceTransactionActionsOptions {
  activeConnectionId: string | null;
  setInTransaction: (value: boolean) => void;
}

export function useWorkspaceTransactionActions({
  activeConnectionId,
  setInTransaction,
}: UseWorkspaceTransactionActionsOptions) {
  const handleBegin = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "BEGIN");
      setInTransaction(true);
      toast.info("Transaction started");
    } catch (error: any) {
      toast.error(error?.message ?? "BEGIN failed");
    }
  }, [activeConnectionId, setInTransaction]);

  const handleCommit = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "COMMIT");
      setInTransaction(false);
      toast.success("Transaction committed");
    } catch (error: any) {
      toast.error(error?.message ?? "COMMIT failed");
    }
  }, [activeConnectionId, setInTransaction]);

  const handleRollback = useCallback(async () => {
    if (!activeConnectionId) return;
    try {
      await DbClient.execute(activeConnectionId, "ROLLBACK");
      setInTransaction(false);
      toast.info("Transaction rolled back");
    } catch (error: any) {
      toast.error(error?.message ?? "ROLLBACK failed");
    }
  }, [activeConnectionId, setInTransaction]);

  return {
    handleBegin,
    handleCommit,
    handleRollback,
  };
}
