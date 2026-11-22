import { expose } from 'comlink';
import { scoreColumnSample } from '@dewpond/ingest';
import { scanColumnSample } from '@dewpond/pii';

const computeApi = {
  ping(): { ok: true; worker: 'compute' } {
    return { ok: true, worker: 'compute' };
  },
  scoreColumnSample,
  scanColumnSample,
};

export type ComputeWorkerApi = typeof computeApi;

expose(computeApi);
