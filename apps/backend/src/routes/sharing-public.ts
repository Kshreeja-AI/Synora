import { Router } from 'express'
import { createApiResponse } from '@synora/shared'
import { sharingService } from '../services/sharing.service'

const router: Router = Router()

router.get('/:shareToken', async (req, res, next) => {
  try {
    const { shareToken } = req.params

    const result = await sharingService.getByShareToken(shareToken)
    res.json(createApiResponse(result))
  } catch (error) {
    next(error)
  }
})

export default router
