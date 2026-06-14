import { createContext, useContext } from "react";

/** オンライン対戦の文脈。online=false ならローカル（pass-and-play）。 */
export interface NetInfo {
  online: boolean;
  /** 自分が操作する座席（playerId）。-1=未割当/オフライン。 */
  mySeat: number;
}

export const NetContext = createContext<NetInfo>({ online: false, mySeat: -1 });
export const useNet = (): NetInfo => useContext(NetContext);
