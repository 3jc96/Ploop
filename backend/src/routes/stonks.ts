import express, { Request, Response, NextFunction } from 'express';
import { body, param, query, validationResult } from 'express-validator';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import pool from '../config/database';

const router = express.Router();

const STONKS_ADMIN_SECRET = process.env.STONKS_ADMIN_SECRET || '';
const API_PUBLIC_URL = (process.env.API_PUBLIC_URL || '').replace(/\/$/, '');

const uploadDir = path.join(process.env.UPLOAD_DIR || './uploads', 'stonks');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    cb(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: parseInt(process.env.STONKS_MAX_FILE_SIZE || '10485760', 10) },
  fileFilter: (_req, file, cb) => {
    const allowed =
      /^(image\/(jpeg|png|gif|webp)|application\/pdf)$/i.test(file.mimetype) ||
      /\.(jpe?g|png|gif|webp|pdf)$/i.test(file.originalname);
    cb(null, allowed);
  },
});

function publicMediaUrl(filename: string): string {
  const rel = `/uploads/stonks/${filename}`;
  return API_PUBLIC_URL ? `${API_PUBLIC_URL}${rel}` : rel;
}

function requireStonksAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === 'admin') {
    next();
    return;
  }
  const header = req.headers['x-stonks-admin-secret'];
  if (STONKS_ADMIN_SECRET && header === STONKS_ADMIN_SECRET) {
    next();
    return;
  }
  res.status(403).json({ error: 'Admin access required to post' });
}

async function fetchPosts(deviceId?: string, postId?: string): Promise<any[]> {
  const params: string[] = [];
  let where = 'WHERE p.is_active = true';
  if (postId) {
    params.push(postId);
    where += ` AND p.id = $${params.length}`;
  }

  const res = await pool.query(
    `SELECT
       p.id,
       p.text,
       p.author_name,
       p.author_handle,
       p.created_at,
       (SELECT COUNT(*)::int FROM stonks_likes l WHERE l.post_id = p.id) AS like_count,
       (SELECT COUNT(*)::int FROM stonks_comments c WHERE c.post_id = p.id) AS comment_count,
       ${
         deviceId
           ? `EXISTS (SELECT 1 FROM stonks_likes l2 WHERE l2.post_id = p.id AND l2.device_id = $${params.length + 1}) AS liked_by_me`
           : 'false AS liked_by_me'
       }
     FROM stonks_posts p
     ${where}
     ORDER BY p.created_at DESC
     ${postId ? 'LIMIT 1' : 'LIMIT 100'}`,
    deviceId ? [...params, deviceId] : params
  );

  if (res.rows.length === 0) return [];

  const ids = res.rows.map((r) => r.id);
  const [mediaRes, commentsRes] = await Promise.all([
    pool.query(
      `SELECT id, post_id, media_url, mime_type, original_name
       FROM stonks_post_media WHERE post_id = ANY($1::uuid[]) ORDER BY created_at`,
      [ids]
    ),
    postId
      ? pool.query(
          `SELECT id, post_id, device_id, author_name, text, created_at
           FROM stonks_comments WHERE post_id = $1 ORDER BY created_at ASC LIMIT 200`,
          [postId]
        )
      : Promise.resolve({ rows: [] as any[] }),
  ]);

  const mediaByPost = new Map<string, any[]>();
  for (const m of mediaRes.rows) {
    const list = mediaByPost.get(m.post_id) || [];
    list.push(m);
    mediaByPost.set(m.post_id, list);
  }

  const commentsByPost = new Map<string, any[]>();
  for (const c of commentsRes.rows) {
    const list = commentsByPost.get(c.post_id) || [];
    list.push(c);
    commentsByPost.set(c.post_id, list);
  }

  return res.rows.map((row) => ({
    id: row.id,
    text: row.text,
    author_name: row.author_name,
    author_handle: row.author_handle,
    created_at: row.created_at,
    like_count: row.like_count,
    comment_count: row.comment_count,
    liked_by_me: row.liked_by_me,
    media: mediaByPost.get(row.id) || [],
    comments: commentsByPost.get(row.id) || [],
  }));
}

// GET /api/stonks/config — public author info
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    author: {
      name: process.env.STONKS_AUTHOR_NAME || 'Joel',
      handle: process.env.STONKS_AUTHOR_HANDLE || '@ploopstonks',
      avatar: process.env.STONKS_AUTHOR_AVATAR || '/assets/logo.png',
      bio: process.env.STONKS_AUTHOR_BIO || 'Daily market notes from the Ploop dev desk.',
    },
    can_post_with_secret: Boolean(STONKS_ADMIN_SECRET),
  });
});

// GET /api/stonks/posts
router.get(
  '/posts',
  [query('device_id').optional().isString().isLength({ min: 8, max: 128 })],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const deviceId = (req.query.device_id as string) || undefined;
      const posts = await fetchPosts(deviceId);
      res.json({ posts });
    } catch (e) {
      console.error('[Stonks] list posts:', e);
      res.status(500).json({ error: 'Failed to load posts' });
    }
  }
);

// GET /api/stonks/posts/:id
router.get(
  '/posts/:id',
  [
    param('id').isUUID(),
    query('device_id').optional().isString().isLength({ min: 8, max: 128 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const deviceId = (req.query.device_id as string) || undefined;
      const posts = await fetchPosts(deviceId, req.params.id);
      if (posts.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }
      res.json({ post: posts[0] });
    } catch (e) {
      console.error('[Stonks] get post:', e);
      res.status(500).json({ error: 'Failed to load post' });
    }
  }
);

// POST /api/stonks/posts — admin compose with optional media
router.post(
  '/posts',
  requireStonksAdmin,
  upload.array('media', 6),
  [body('text').isString().trim().isLength({ min: 1, max: 4000 })],
  async (req: Request, res: Response) => {
    const files = (req.files as Express.Multer.File[]) || [];
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        files.forEach((f) => fs.unlinkSync(f.path));
        return res.status(400).json({ errors: errors.array() });
      }

      const postId = uuidv4();
      const text = String(req.body.text).trim();
      const authorName = process.env.STONKS_AUTHOR_NAME || 'Joel';
      const authorHandle = process.env.STONKS_AUTHOR_HANDLE || '@ploopstonks';

      await pool.query(
        `INSERT INTO stonks_posts (id, text, author_name, author_handle)
         VALUES ($1, $2, $3, $4)`,
        [postId, text, authorName, authorHandle]
      );

      for (const file of files) {
        const mediaUrl = publicMediaUrl(file.filename);
        await pool.query(
          `INSERT INTO stonks_post_media (id, post_id, media_url, media_path, mime_type, original_name)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [uuidv4(), postId, mediaUrl, file.path, file.mimetype, file.originalname]
        );
      }

      const posts = await fetchPosts(undefined, postId);
      res.status(201).json({ post: posts[0] });
    } catch (e) {
      console.error('[Stonks] create post:', e);
      files.forEach((f) => {
        try {
          fs.unlinkSync(f.path);
        } catch {
          /* ignore */
        }
      });
      res.status(500).json({ error: 'Failed to create post' });
    }
  }
);

// POST /api/stonks/posts/:id/like — toggle like
router.post(
  '/posts/:id/like',
  [
    param('id').isUUID(),
    body('device_id').isString().trim().isLength({ min: 8, max: 128 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const deviceId = req.body.device_id;

      const exists = await pool.query(`SELECT id FROM stonks_posts WHERE id = $1 AND is_active = true`, [id]);
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const liked = await pool.query(
        `SELECT 1 FROM stonks_likes WHERE post_id = $1 AND device_id = $2`,
        [id, deviceId]
      );

      let likedByMe: boolean;
      if (liked.rows.length > 0) {
        await pool.query(`DELETE FROM stonks_likes WHERE post_id = $1 AND device_id = $2`, [id, deviceId]);
        likedByMe = false;
      } else {
        await pool.query(
          `INSERT INTO stonks_likes (post_id, device_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [id, deviceId]
        );
        likedByMe = true;
      }

      const countRes = await pool.query(
        `SELECT COUNT(*)::int AS c FROM stonks_likes WHERE post_id = $1`,
        [id]
      );

      res.json({ liked: likedByMe, like_count: countRes.rows[0]?.c ?? 0 });
    } catch (e) {
      console.error('[Stonks] like:', e);
      res.status(500).json({ error: 'Failed to update like' });
    }
  }
);

// GET /api/stonks/posts/:id/comments
router.get('/posts/:id/comments', [param('id').isUUID()], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    const res2 = await pool.query(
      `SELECT id, author_name, text, created_at
       FROM stonks_comments WHERE post_id = $1 ORDER BY created_at ASC LIMIT 200`,
      [req.params.id]
    );
    res.json({ comments: res2.rows });
  } catch (e) {
    console.error('[Stonks] comments:', e);
    res.status(500).json({ error: 'Failed to load comments' });
  }
});

// POST /api/stonks/posts/:id/comments
router.post(
  '/posts/:id/comments',
  [
    param('id').isUUID(),
    body('device_id').isString().trim().isLength({ min: 8, max: 128 }),
    body('text').isString().trim().isLength({ min: 1, max: 1000 }),
    body('author_name').optional().isString().trim().isLength({ max: 60 }),
  ],
  async (req: Request, res: Response) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const { id } = req.params;
      const deviceId = req.body.device_id;
      const text = req.body.text;
      const authorName = (req.body.author_name || 'Guest').trim().slice(0, 60);

      const exists = await pool.query(`SELECT id FROM stonks_posts WHERE id = $1 AND is_active = true`, [id]);
      if (exists.rows.length === 0) {
        return res.status(404).json({ error: 'Post not found' });
      }

      const commentId = uuidv4();
      const result = await pool.query(
        `INSERT INTO stonks_comments (id, post_id, device_id, author_name, text)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, author_name, text, created_at`,
        [commentId, id, deviceId, authorName, text]
      );

      res.status(201).json({ comment: result.rows[0] });
    } catch (e) {
      console.error('[Stonks] add comment:', e);
      res.status(500).json({ error: 'Failed to add comment' });
    }
  }
);

export default router;
