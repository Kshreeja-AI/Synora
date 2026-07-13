# Netlify Deployment Guide

## Overview

This guide covers deploying the Synora frontend (Next.js) to Netlify for staging and production environments.

## Prerequisites

- Netlify account (free or paid)
- GitHub account with access to Synora repository
- Domain name (optional, can use Netlify subdomain)
- API backend URL (staging and production)

## Quick Start - GitHub Integration

### 1. Connect Repository

1. Go to [Netlify Dashboard](https://app.netlify.com)
2. Click "New site from Git"
3. Select GitHub as provider
4. Authorize Netlify to access your GitHub account
5. Select the Synora repository
6. Click "Deploy site"

### 2. Configure Build Settings

**Build Command**: `npm run build --scope=@synora/web`

**Publish Directory**: `apps/web/.next`

**Node Version**: 20

**NPM Version**: 10

### 3. Set Environment Variables

In Netlify Dashboard → Site settings → Environment:

```
NEXT_PUBLIC_API_URL=https://api-staging.synora.example.com
NEXTAUTH_URL=https://staging.synora.example.com
NEXTAUTH_SECRET=<generate-with-openssl-rand-base64-32>
NODE_ENV=production
```

### 4. Trigger Deployment

Netlify automatically deploys on:
- Push to main branch → Production
- Push to develop branch → Staging
- Pull requests → Preview deployments

## Advanced Configuration

### Custom Domain

1. Netlify Dashboard → Domain settings
2. Add custom domain
3. Configure DNS records:
   - CNAME to `<netlify-site>.netlify.app`
   - Or use Netlify DNS nameservers

### SSL/TLS Certificate

Netlify automatically provides:
- Free SSL certificate via Let's Encrypt
- Auto-renewal
- HSTS headers configured

### Environment Variables by Branch

**Production (main)**:
```
NEXT_PUBLIC_API_URL=https://api.synora.example.com
NEXTAUTH_URL=https://synora.example.com
```

**Staging (develop)**:
```
NEXT_PUBLIC_API_URL=https://api-staging.synora.example.com
NEXTAUTH_URL=https://staging.synora.example.com
```

**Preview (pull requests)**:
```
NEXT_PUBLIC_API_URL=https://api-staging.synora.example.com
```

## Deployment Workflow

### Automatic Deployments

```
main branch → Production deploy
develop branch → Staging deploy
PR → Preview deploy (temporary)
```

### Manual Deployments

1. Dashboard → Deploys
2. Click "Trigger deploy"
3. Select branch and environment
4. Wait for build to complete

### Rollback

1. Dashboard → Deploys
2. Find previous deployment
3. Click "Publish deploy"
4. Confirm to rollback

## Monitoring & Logs

### Build Logs
- Dashboard → Deploys
- Click deployment
- View real-time build output

### Runtime Logs
- Dashboard → Logs
- Filter by timestamp or environment
- Search for specific errors

### Analytics
- Dashboard → Analytics
- Track page views
- Monitor build times
- View traffic sources

## Performance Optimization

### Image Optimization

Netlify automatically optimizes images:
- WebP conversion
- Responsive sizing
- Lazy loading

### Caching

Configure cache headers in `netlify.toml`:

```toml
[[headers]]
  for = "/_next/static/*"
  [headers.values]
    Cache-Control = "public, max-age=31536000, immutable"
```

### CDN

Netlify automatically uses global CDN:
- 200+ edge locations
- Automatic failover
- DDoS protection

## Environment-Specific Deployment

### Staging Environment

```bash
# Deploy from develop branch
git push origin develop

# Wait for Netlify to build and deploy
# Access at: https://staging.synora.example.com
```

### Production Environment

```bash
# Create release tag
git tag v1.0.0

# Push tag to trigger production build
git push origin v1.0.0

# Or push to main branch
git push origin main

# Access at: https://synora.example.com
```

## Troubleshooting

### Build Failures

1. Check build logs in Netlify Dashboard
2. Verify environment variables set correctly
3. Check `netlify.toml` configuration
4. Verify `npm run build` works locally:
   ```bash
   npm run build --scope=@synora/web
   ```

### Deployment Issues

1. Verify GitHub integration is authorized
2. Check repository visibility (public/private)
3. Verify branch protection rules don't block deployments
4. Clear build cache: Dashboard → Deploys → Clear cache & rebuild

### API Connection Issues

1. Verify `NEXT_PUBLIC_API_URL` is set correctly
2. Check CORS headers on backend API
3. Verify backend is running and accessible
4. Check browser console for errors

### Performance Issues

1. Monitor Lighthouse scores (available in Netlify)
2. Check image sizes and optimization
3. Review JavaScript bundle size
4. Use Netlify Analytics to identify slow pages

## Security

### Secrets Management

Never commit secrets to GitHub:

```bash
# Generate secrets locally
openssl rand -base64 32  # For NEXTAUTH_SECRET

# Set in Netlify dashboard (not in .env files)
```

### HTTPS/TLS

- Automatic SSL certificate provisioning
- HSTS headers enabled
- TLS 1.2+ enforced

### Headers Security

Configured in `netlify.toml`:
- X-Frame-Options: SAMEORIGIN
- X-Content-Type-Options: nosniff
- X-XSS-Protection: 1; mode=block
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: geolocation, microphone, camera disabled

## Monitoring & Analytics

### Netlify Analytics

1. Dashboard → Analytics
2. Monitor:
   - Page views
   - Build times
   - Deployment frequency
   - Error rates

### Custom Analytics

Integrate with:
- Google Analytics
- Vercel Analytics
- Datadog
- New Relic
- CloudFlare

## Cost Optimization

### Free Tier Limits

- 300 build minutes/month
- 100 deploys/month
- 1 concurrent build

### Pro Tier Benefits

- Unlimited build minutes
- Unlimited deploys
- 5 concurrent builds
- Advanced analytics
- Early access to features

### Cost Reduction Tips

1. Batch deployments
2. Use preview deployments for testing
3. Cache dependencies
4. Optimize build time
5. Use branch-specific builds

## Migration from Other Platforms

### From Vercel

1. Export environment variables
2. Create new Netlify site
3. Connect GitHub repository
4. Update domain DNS
5. Test in staging first

### From AWS Amplify

1. Export build configuration
2. Create equivalent `netlify.toml`
3. Update environment variables
4. Verify build succeeds
5. Update domain DNS

## Integration with Backend

### API Configuration

Set API URL in environment:

```env
NEXT_PUBLIC_API_URL=https://api-staging.synora.example.com
```

### CORS Headers

Backend should allow Netlify origin:

```nginx
add_header Access-Control-Allow-Origin "https://staging.synora.example.com";
```

### Health Checks

Configure health checks in backend:

```typescript
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});
```

## Continuous Deployment Workflow

### Development → Staging → Production

```
1. Developer pushes to feature branch
2. PR opens → Preview deploy created
3. After review, merge to develop
4. Staging environment updates automatically
5. After testing, merge to main
6. Production environment updates automatically
```

### Automated Testing

Add Netlify build hooks to run tests:

```bash
# In build command
npm run lint && npm run test && npm run build
```

## Support & Documentation

- [Netlify Documentation](https://docs.netlify.com)
- [Netlify Community](https://community.netlify.com)
- [Next.js Deployment Guide](https://nextjs.org/docs/deployment)

## Examples

### Successful Staging Deployment

```
Branch: develop
Build Status: ✅ Success
Build Time: 2m 34s
Preview URL: https://develop--synora.netlify.app
```

### Successful Production Deployment

```
Branch: main
Build Status: ✅ Success
Build Time: 2m 28s
Live URL: https://synora.example.com
```

---

**Last Updated**: 2026-07-13  
**Status**: Production Ready  
**Next Review**: Monthly

