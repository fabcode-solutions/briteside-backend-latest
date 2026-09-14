import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class SwaggerGenerator {
  constructor() {
    this.paths = {};
    this.components = {
      schemas: {},
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    };
    this.routesDir = path.join(__dirname, '../routes');
    this.controllersDir = path.join(__dirname, '../controllers');
  }

  // Extract route information from route files
  async analyzeRoutes() {
    const routeFiles = fs
      .readdirSync(this.routesDir)
      .filter(file => file.endsWith('.js') && file !== 'index.js');

    for (const file of routeFiles) {
      await this.analyzeRouteFile(file);
    }
  }

  async analyzeRouteFile(filename) {
    const filePath = path.join(this.routesDir, filename);
    const content = fs.readFileSync(filePath, 'utf8');

    // Extract route prefix from index.js
    const routePrefix = this.getRoutePrefix(filename);

    // Parse routes using regex patterns
    const routes = this.extractRoutes(content, routePrefix);

    for (const route of routes) {
      await this.generateSwaggerPath(route);
    }
  }

  getRoutePrefix(filename) {
    const indexPath = path.join(this.routesDir, 'index.js');
    const indexContent = fs.readFileSync(indexPath, 'utf8');

    const routeMap = {
      'auth.route.js': '/auth',
      'user.route.js': '/users',
      'event.route.js': '/events',
      'group.route.js': '/groups',
      'ticket.route.js': '/tickets',
      'venue.route.js': '/venues',
      'category.route.js': '/categories',
      'organizer.route.js': '/organizers',
      'upload.route.js': '/upload',
      'social.route.js': '/social',
      'socialChat.route.js': '/socialChat',
      'eventChat.route.js': '',
      'review.route.js': '/reviews',
      'analytics.route.js': '/analytics',
      'organizerProfile.route.js': '/organizer-profiles',
      'ticketScanning.route.js': '/ticket-scanning',
      'stream.route.js': '/stream',
      'order.route.js': '/orders',
      'payment.route.js': '/payment',
      'notification.route.js': '/notifications',
      'report.route.js': '/reports',
    };

    return routeMap[filename] || '';
  }

  extractRoutes(content, prefix) {
    const routes = [];

    // Match router.method patterns
    const routeRegex =
      /router\.(get|post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]\s*,\s*([^)]+)\)/g;
    let match;

    while ((match = routeRegex.exec(content)) !== null) {
      const [, method, path, handlers] = match;
      const fullPath = prefix + path;

      // Extract controller function name
      const controllerMatch = handlers.match(/(\w+)(?:\.\w+)?$/);
      const controllerFunction = controllerMatch ? controllerMatch[1] : null;

      routes.push({
        method: method.toLowerCase(),
        path: this.normalizePath(fullPath),
        originalPath: path,
        handlers,
        controllerFunction,
        requiresAuth: content.includes('authMiddleware') || handlers.includes('authMiddleware'),
      });
    }

    // Also match route() patterns
    const routeChainRegex =
      /router\.route\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\.(get|post|put|delete|patch)\s*\(([^)]+)\)/g;

    while ((match = routeChainRegex.exec(content)) !== null) {
      const [, path, method, handlers] = match;
      const fullPath = prefix + path;

      const controllerMatch = handlers.match(/(\w+)(?:\.\w+)?$/);
      const controllerFunction = controllerMatch ? controllerMatch[1] : null;

      routes.push({
        method: method.toLowerCase(),
        path: this.normalizePath(fullPath),
        originalPath: path,
        handlers,
        controllerFunction,
        requiresAuth: content.includes('authMiddleware') || handlers.includes('authMiddleware'),
      });
    }

    return routes;
  }

  normalizePath(path) {
    // Convert Express params to OpenAPI format
    return path.replace(/:(\w+)/g, '{$1}');
  }

  async generateSwaggerPath(route) {
    const { method, path, controllerFunction, requiresAuth } = route;

    if (!this.paths[path]) {
      this.paths[path] = {};
    }

    // Generate basic path info
    const pathInfo = {
      summary: this.generateSummary(method, path, controllerFunction),
      description: this.generateDescription(method, path, controllerFunction),
      tags: [this.getTagFromPath(path)],
      responses: this.generateResponses(method, path),
    };

    // Add security if auth required
    if (requiresAuth) {
      pathInfo.security = [{ bearerAuth: [] }];
    }

    // Add parameters for path params
    const pathParams = this.extractPathParams(path);
    if (pathParams.length > 0) {
      pathInfo.parameters = pathParams.map(param => ({
        name: param,
        in: 'path',
        required: true,
        schema: { type: 'string' },
        description: `${param} identifier`,
      }));
    }

    // Add request body for POST/PUT/PATCH
    if (['post', 'put', 'patch'].includes(method)) {
      pathInfo.requestBody = this.generateRequestBody(path, controllerFunction);
    }

    // Add query parameters for GET requests
    if (method === 'get' && this.shouldHaveQueryParams(path)) {
      if (!pathInfo.parameters) pathInfo.parameters = [];
      pathInfo.parameters.push(...this.generateQueryParams(path));
    }

    this.paths[path][method] = pathInfo;
  }

  generateSummary(method, path, controllerFunction) {
    const action = {
      get: 'Get',
      post: 'Create',
      put: 'Update',
      patch: 'Update',
      delete: 'Delete',
    }[method];

    const resource = this.getResourceFromPath(path);
    return `${action} ${resource}`;
  }

  generateDescription(method, path, controllerFunction) {
    const resource = this.getResourceFromPath(path);
    const action = {
      get: 'Retrieve',
      post: 'Create a new',
      put: 'Update an existing',
      patch: 'Partially update an existing',
      delete: 'Delete an existing',
    }[method];

    return `${action} ${resource.toLowerCase()}`;
  }

  getTagFromPath(path) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'General';

    const tagMap = {
      auth: 'Authentication',
      users: 'Users',
      events: 'Events',
      groups: 'Groups',
      tickets: 'Tickets',
      venues: 'Venues',
      categories: 'Categories',
      organizers: 'Organizers',
      upload: 'Upload',
      social: 'Social',
      socialChat: 'Social Chat',
      eventChat: 'Event Chat',
      reviews: 'Reviews',
      analytics: 'Analytics',
      'organizer-profiles': 'Organizer Profiles',
      'ticket-scanning': 'Ticket Scanning',
      stream: 'Stream',
      orders: 'Orders',
      payment: 'Payment',
      notifications: 'Notifications',
    };

    return tagMap[segments[0]] || segments[0].charAt(0).toUpperCase() + segments[0].slice(1);
  }

  getResourceFromPath(path) {
    const segments = path.split('/').filter(Boolean);
    if (segments.length === 0) return 'Resource';

    // Get the main resource name
    let resource = segments[0];

    // Handle specific cases
    if (segments.includes('comments')) resource = 'comment';
    else if (segments.includes('posts')) resource = 'post';
    else if (segments.includes('stories')) resource = 'story';
    else if (segments.includes('follow')) resource = 'follow relationship';
    else if (segments.includes('like')) resource = 'like';
    else if (segments.includes('save')) resource = 'saved item';

    return resource.charAt(0).toUpperCase() + resource.slice(1);
  }

  extractPathParams(path) {
    const matches = path.match(/\{(\w+)\}/g);
    return matches ? matches.map(match => match.slice(1, -1)) : [];
  }

  generateResponses(method, path) {
    const successSchema = this.generateSuccessResponseSchema(path, method);

    const responses = {
      200: {
        description: 'Success',
        content: {
          'application/json': {
            schema: successSchema,
          },
        },
      },
    };

    if (method === 'post') {
      responses['201'] = {
        description: 'Created successfully',
        content: {
          'application/json': {
            schema: successSchema,
          },
        },
      };
    }

    responses['400'] = {
      description: 'Bad Request - Invalid input data',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Validation failed' },
              error: { type: 'string', example: 'Invalid email format' },
              details: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };

    responses['401'] = {
      description: 'Unauthorized - Authentication required',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Authentication required' },
              error: { type: 'string', example: 'Invalid or missing token' },
            },
          },
        },
      },
    };

    responses['403'] = {
      description: 'Forbidden - Insufficient permissions',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Access denied' },
              error: { type: 'string', example: 'Insufficient permissions' },
            },
          },
        },
      },
    };

    responses['404'] = {
      description: 'Not Found - Resource not found',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Resource not found' },
              error: { type: 'string', example: 'The requested resource does not exist' },
            },
          },
        },
      },
    };

    responses['500'] = {
      description: 'Internal Server Error',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: false },
              message: { type: 'string', example: 'Internal server error' },
              error: { type: 'string', example: 'An unexpected error occurred' },
            },
          },
        },
      },
    };

    return responses;
  }

  generateSuccessResponseSchema(path, method, controllerFunction) {
    const baseSchema = {
      type: 'object',
      properties: {
        success: { type: 'boolean', example: true },
        message: { type: 'string' },
        data: { type: 'object' },
      },
    };

    // Customize response based on path
    if (path.includes('/auth/login') || path.includes('/auth/register')) {
      baseSchema.properties.data = {
        type: 'object',
        properties: {
          user: {
            type: 'object',
            properties: {
              id: { type: 'string', example: 'user-id-123' },
              email: { type: 'string', example: 'user@example.com' },
              firstName: { type: 'string', example: 'John' },
              lastName: { type: 'string', example: 'Doe' },
              username: { type: 'string', example: 'johndoe' },
            },
          },
          token: { type: 'string', example: 'jwt-token-here' },
        },
      };
    }
    if (
      path.includes('/users/profile') ||
      (path.includes('/users') &&
        (controllerFunction === 'updateUserProfile' || controllerFunction === 'updateProfile'))
    ) {
      return {
        type: 'object',
        properties: {
          image: {
            type: 'string',
            format: 'uri',
            example: 'https://example.com/profile.jpg',
            description: 'Profile image URL',
          },
          bio: {
            type: 'string',
            maxLength: 500,
            example: 'A passionate event organizer and community builder',
            description: 'User bio (max 500 characters)',
          },
          firstName: {
            type: 'string',
            minLength: 1,
            example: 'John',
            description: 'User first name',
          },
          lastName: {
            type: 'string',
            minLength: 1,
            example: 'Doe',
            description: 'User last name',
          },
        },
      };
    }
    // list endpoints for posts (user's own, reposted, shared, saved, etc)
    if (
      (path.includes('/social/posts') ||
        path.includes('/social/shared-posts') ||
        path.includes('/social/reposted-posts') ||
        path.includes('/social/saved-posts') ||
        path.includes('/social/hidden-posts') ||
        path.includes('/social/liked-posts') ||
        path.includes('/social/commented-posts')) &&
      method === 'get'
    ) {
      baseSchema.properties.data = {
        type: 'object',
        properties: {
          posts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                caption: { type: 'string' },
                mediaUrls: { type: 'array', items: { type: 'string' } },
                likesCount: { type: 'integer' },
                commentsCount: { type: 'integer' },
                createdAt: { type: 'string', format: 'date-time' },
              },
            },
          },
        },
      };
      baseSchema.properties.pagination = {
        type: 'object',
        properties: {
          page: { type: 'integer' },
          limit: { type: 'integer' },
          hasMore: { type: 'boolean' },
        },
      };
    }

    return baseSchema;
  }

  generateRequestBody(path, controllerFunction) {
    const schema = this.generateSchemaForPath(path, controllerFunction);

    return {
      required: true,
      content: {
        'application/json': {
          schema,
        },
      },
    };
  }

  generateSchemaForPath(path, controllerFunction) {
    // Authentication schemas
    if (path.includes('/auth/register')) {
      return {
        type: 'object',
        required: ['email', 'password', 'firstName', 'lastName', 'username', 'dob'],
        properties: {
          email: { type: 'string', format: 'email', example: 'user@example.com' },
          password: { type: 'string', minLength: 8, example: 'password123' },
          firstName: { type: 'string', example: 'John' },
          lastName: { type: 'string', example: 'Doe' },
          username: { type: 'string', minLength: 3, maxLength: 20, example: 'johndoe' },
          dob: { type: 'string', format: 'date', example: '1990-01-01' },
        },
      };
    }

    if (path.includes('/auth/login')) {
      return {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          password: { type: 'string', example: 'password123' },
        },
      };
    }

    if (path.includes('/auth/forgot-password')) {
      return {
        type: 'object',
        required: ['email'],
        properties: {
          email: { type: 'string', format: 'email', example: 'user@example.com' },
        },
      };
    }

    if (path.includes('/auth/reset-password')) {
      return {
        type: 'object',
        required: ['token', 'password'],
        properties: {
          token: { type: 'string', example: 'reset-token-123' },
          password: { type: 'string', minLength: 8, example: 'newpassword123' },
        },
      };
    }

    // Social schemas
    if (path.includes('/social/posts') && !path.includes('{postId}')) {
      return {
        type: 'object',
        properties: {
          caption: { type: 'string', maxLength: 2200, example: 'Check out this amazing event!' },
          mediaUrls: {
            type: 'array',
            items: { type: 'string' },
            example: ['https://example.com/image1.jpg', 'https://example.com/image2.jpg'],
          },
          mediaTypes: {
            type: 'array',
            items: { type: 'string', enum: ['image', 'video'] },
            example: ['image', 'image'],
          },
          location: { type: 'string', example: 'New York, NY' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            example: ['music', 'concert', 'entertainment'],
          },
        },
      };
    }

    if (path.includes('/social/posts/{postId}') && path.includes('comments')) {
      return {
        type: 'object',
        required: ['content'],
        properties: {
          content: { type: 'string', example: 'Great post!' },
          parentId: { type: 'string', example: 'comment-id-123' },
        },
      };
    }

    if (path.includes('/social/profile') && !path.includes('{userId}')) {
      return {
        type: 'object',
        properties: {
          bio: { type: 'string', maxLength: 500, example: 'Event enthusiast and music lover' },
          website: { type: 'string', format: 'uri', example: 'https://johndoe.com' },
          location: { type: 'string', example: 'New York, NY' },
          isPublic: { type: 'boolean', example: true },
          coverImages: {
            type: 'array',
            items: { type: 'string', format: 'uri' },
            example: ['https://example.com/cover1.jpg', 'https://example.com/cover2.jpg'],
            description: 'Optional array of cover image URLs for profile',
          },
        },
      };
    }

    if (path.includes('/social/interests')) {
      return {
        type: 'object',
        required: ['interests'],
        properties: {
          interests: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                categoryId: { type: 'string', example: 'category-id-123' },
                intensity: { type: 'integer', minimum: 0, maximum: 100, example: 80 },
                isVisible: { type: 'boolean', example: true },
              },
            },
          },
        },
      };
    }

    // Event schemas
    if (path.includes('/events') && !path.includes('{')) {
      return {
        type: 'object',
        required: ['title', 'description', 'startDate', 'endDate', 'venueId', 'categoryId'],
        properties: {
          title: { type: 'string', example: 'Summer Music Festival' },
          description: { type: 'string', example: 'An amazing summer music festival' },
          startDate: { type: 'string', format: 'date-time', example: '2024-07-15T18:00:00Z' },
          endDate: { type: 'string', format: 'date-time', example: '2024-07-15T23:00:00Z' },
          venueId: { type: 'string', example: 'venue-id-123' },
          categoryId: { type: 'string', example: 'category-id-123' },
          maxAttendees: { type: 'integer', example: 1000 },
          isPublic: { type: 'boolean', example: true },
        },
      };
    }

    // Default schema
    return {
      type: 'object',
      properties: {
        data: {
          type: 'object',
          description: 'Request data',
        },
      },
    };
  }

  shouldHaveQueryParams(path) {
    return (
      path.includes('/posts') ||
      path.includes('/events') ||
      path.includes('/search') ||
      path.includes('/followers') ||
      path.includes('/following') ||
      path.includes('/feed')
    );
  }

  generateQueryParams(path) {
    const params = [];

    // Common pagination params
    if (this.shouldHaveQueryParams(path)) {
      params.push(
        {
          name: 'page',
          in: 'query',
          schema: { type: 'integer', minimum: 1, default: 1 },
          description: 'Page number',
        },
        {
          name: 'limit',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
          description: 'Number of items per page',
        }
      );
    }

    // Search specific params
    if (path.includes('/search')) {
      params.push({
        name: 'q',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Search query',
      });
    }

    // Posts specific params
    if (path.includes('/posts')) {
      params.push(
        {
          name: 'userId',
          in: 'query',
          schema: { type: 'string' },
          description: 'Filter by user ID',
        },
        {
          name: 'sortBy',
          in: 'query',
          schema: { type: 'string', enum: ['createdAt', 'likesCount'] },
          description: 'Sort field',
        },
        {
          name: 'sortOrder',
          in: 'query',
          schema: { type: 'string', enum: ['asc', 'desc'] },
          description: 'Sort order',
        }
      );
    }

    return params;
  }

  async generate() {
    await this.analyzeRoutes();

    return {
      paths: this.paths,
      components: this.components,
    };
  }
}

export default SwaggerGenerator;
