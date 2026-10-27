describe('isAllowedOrigin', () => {
  const load = (origins: string) => {
    process.env.CORS_ORIGINS = origins
    let isAllowedOrigin!: (origin: string) => boolean
    jest.isolateModules(() => {
      isAllowedOrigin = require('@clyde-api/utils/cors').isAllowedOrigin
    })
    return isAllowedOrigin
  }

  afterAll(() => {
    delete process.env.CORS_ORIGINS
  })

  it('matches exact origins', () => {
    const isAllowed = load('http://localhost:5173, https://faqs.example.com')

    expect(isAllowed('https://faqs.example.com')).toBe(true)
    expect(isAllowed('https://other.example.com')).toBe(false)
  })

  it('matches any subdomain for a wildcard entry', () => {
    const isAllowed = load('https://*.lovable.app')

    expect(isAllowed('https://clinic-faqs.lovable.app')).toBe(true)
    expect(isAllowed('https://id-preview--abc123.lovable.app')).toBe(true)
    expect(isAllowed('https://lovable.app')).toBe(false)
    expect(isAllowed('https://evil.com/?.lovable.app')).toBe(false)
    expect(isAllowed('https://clinic.lovable.app.evil.com')).toBe(false)
  })
})
