export type HealthMeta = {
  ok: true;
  service: string;
  timestamp: string;
};

export declare function buildHealthMeta(service: string): HealthMeta;
