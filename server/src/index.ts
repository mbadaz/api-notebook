import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { router } from './router.js';
import { HttpError } from './workspaceFs.js';

const PORT = Number(process.env.PORT ?? 3001);

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));
app.use('/api', router);

// In production, serve the built client from the same server.
const clientDist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../client/dist'
);
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(
  (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      const message = err instanceof Error ? err.message : 'Internal error';
      res.status(500).json({ error: message });
    }
  }
);

app.listen(PORT, () => {
  console.log(`API Notebook server listening on http://localhost:${PORT}`);
});
