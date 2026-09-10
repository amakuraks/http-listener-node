import type { Request, Response } from 'express';
import { prisma } from '../db.ts';
import { normalizeHeaders } from '../lib/headers.ts';
import { encodeBody } from '../lib/body.ts';

export async function capture(req: Request, res: Response): Promise<void> {
  // VERIFIED: express.raw leaves req.body as {} (not an empty Buffer) on a bodyless
  // request such as GET or DELETE. Without this guard, .toString() throws.
  const buf = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const { body, bodyEncoding, bodySize } = encodeBody(buf);

  try {
    await prisma.requestLog.create({
      data: {
        method: req.method,
        url: req.originalUrl,
        headers: normalizeHeaders(req.headers),
        query: JSON.parse(JSON.stringify(req.query)),
        body,
        bodyEncoding,
        bodySize,
      },
    });
    res.status(200).json({ status: 'OK' });
  } catch (error) {
    // Spec 16: never return 200 when persistence is known to have failed.
    console.error('[listen] persist failed:', error);
    res.status(500).json({ status: 'ERROR' });
  }
}
