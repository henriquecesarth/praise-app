import { describe, it, expect } from 'vitest';
import { resolveStagingCorsOrigin as resolve, INTEGRATED_STAGING_WEB_ORIGIN as web, LEGACY_STAGING_WEB_ORIGIN as old } from './staging-origins';
import { isAllowedOrigin } from './cors.config';

describe('integrated Staging exact origins',()=>{
 const env={VERCEL_ENV:'preview',LOUVAIO_STAGING_INTEGRATION:'m20-c14'};
 const corsOrigin=resolve(env);
 it('preserves both exact Staging origins',()=>{for(const origin of [web,old])expect(isAllowedOrigin(origin,{nodeEnv:'production',corsOrigin})).toBe(true);});
 it.each(['*','https://arbitrary.vercel.app','https://praise-app-m7tn.vercel.app',web+'.evil.test','http://louvaio-m20-c14-web-staging.vercel.app',web+':8443','null','https://user@louvaio-m20-c14-web-staging.vercel.app'])('rejects %s',origin=>expect(isAllowedOrigin(origin,{nodeEnv:'production',corsOrigin})).toBe(false));
 it('does not include arbitrary shared configuration in integrated mode',()=>expect(resolve({...env,CORS_ORIGIN:'https://praise-app-m7tn.vercel.app,*'})).toBe(corsOrigin));
 it.each(['production','development',''])('fails closed outside Preview: %s',VERCEL_ENV=>expect(()=>resolve({...env,VERCEL_ENV})).toThrow());
 it('rejects unrecognized mode',()=>expect(()=>resolve({...env,LOUVAIO_STAGING_INTEGRATION:'other'})).toThrow());
 it('does not change ordinary Preview or Production policies',()=>{for(const VERCEL_ENV of ['preview','production'])expect(resolve({VERCEL_ENV,CORS_ORIGIN:'https://existing.example.test'})).toBe('https://existing.example.test');});
});
