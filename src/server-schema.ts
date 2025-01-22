import {z} from 'zod';

export const workerMessageSchema = z.object({
    requestType: z.string(),
    headers: z.any(),
    body: z.any(),
    url: z.string(),
});

export const workerMessageReplySchema = z.object({
    data: z.string().optional(),
    error: z.string().optional(),
    errorCode: z.enum(['500', '404']).optional(),
});

export type WorkerMessageType = z.infer<typeof workerMessageSchema>;
export type WorkerMessageReplyType = z.infer<typeof workerMessageReplySchema>;