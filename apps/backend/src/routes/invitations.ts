import { Router } from 'express';
import { authMiddleware, AuthRequest } from '../middleware/auth';
import { createApiResponse } from '@synora/shared';
import { previewInvitation, acceptInvitation } from '../services/invitation.service';

const router: Router = Router();

// No auth required — the token itself is the credential to preview (not
// accept) an invitation, so an unauthenticated visitor following an email
// link can see what workspace/role they're being invited to before signing
// up or logging in.
router.get('/:token', async (req, res, next) => {
  try {
    const preview = await previewInvitation(req.params.token);
    res.json(createApiResponse(preview));
  } catch (error) {
    next(error);
  }
});

router.post('/:token/accept', authMiddleware, async (req: AuthRequest, res, next) => {
  try {
    const result = await acceptInvitation(req.userId!, req.params.token);
    res.json(createApiResponse(result));
  } catch (error) {
    next(error);
  }
});

export default router;
