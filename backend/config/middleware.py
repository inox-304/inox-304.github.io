class ResponsePolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response.headers['Permissions-Policy'] = 'camera=(), microphone=(), geolocation=()'
        if request.path.startswith(('/admin/', '/api/', '/media/')):
            response.headers['Cache-Control'] = 'no-store, private'
        if request.path.startswith('/admin/'):
            response.headers['X-Robots-Tag'] = 'noindex, nofollow'
            response.headers['Referrer-Policy'] = 'same-origin'
        return response
