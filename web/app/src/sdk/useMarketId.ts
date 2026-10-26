import { useMemo } from "react";
import { useParams } from "react-router-dom";

export function useMarketId(): bigint | null {
  const { marketId } = useParams();
  return useMemo(() => {
    if (marketId === undefined || !/^\d+$/.test(marketId)) return null;
    try {
      return BigInt(marketId);
    } catch {
      return null;
    }
  }, [marketId]);
}
