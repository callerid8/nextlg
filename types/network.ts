// Interfaces
export interface MtrData {
  Hop: number;
  ASN: string;
  Prefix: string;
  Host: string;
  SentPackets: number[];
  ReceivedPackets: number[];
  Pings: number[];
  Last: number;
  Best: number;
  Worst: number;
  Avg: number;
  StDev: number;
  LossPercent: number;
  isHidden: boolean;
}

export interface MtrTableProps {
  data: MtrData[];
  sourceInfo?: {
    hostname: string;
    ips: string[];
  };
  target?: string;
}
