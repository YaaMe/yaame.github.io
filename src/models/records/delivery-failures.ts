export type ExhaustedDelivery = {
  inbox?: string;
  reason: string;
  attempts: number;
  [key: string]: unknown;
};

export type DeliveryFailure = ExhaustedDelivery & { at: string };
