/**
 * Generates realistic OpenAPI fixtures shaped like the documents emitted by
 * the frameworks RouteCraft supports. Run with `npm run fixtures`.
 *
 * The documents are intentionally small but exercise the details that break
 * real specs: $refs, allOf, nullable/oneOf, security schemes, Swagger 2 body
 * and formData parameters, server variables, examples and circular models.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'fixtures');
mkdirSync(outDir, { recursive: true });

const errorSchema = {
  type: 'object',
  required: ['detail'],
  properties: {
    detail: { type: 'string', description: 'Human readable error message.' },
    code: { type: 'integer', format: 'int32' },
  },
};

function write(name, document) {
  writeFileSync(resolve(outDir, name), `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function writeYaml(name, document) {
  writeFileSync(resolve(outDir, name), `${stringify(document)}\n`, 'utf8');
}

/* ------------------------------- FastAPI -------------------------------- */
write('fastapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'FastAPI Demo',
    version: '1.0.0',
    description:
      'A demo API used to exercise **RouteCraft**.\n\nIt covers path, query, header and cookie parameters, a bearer token, circular models and rich response examples.',
    termsOfService: 'https://example.com/terms',
  },
  servers: [{ url: 'http://127.0.0.1:4010', description: 'Local demo server' }],
  tags: [
    { name: 'pets', description: 'Everything about pets.' },
    { name: 'auth', description: 'Token protected endpoints.' },
  ],
  paths: {
    '/pets': {
      get: {
        tags: ['pets'],
        summary: 'List pets',
        description: 'Returns a paginated list of pets. Filter by status or search by name.',
        operationId: 'list_pets',
        parameters: [
          {
            name: 'limit',
            in: 'query',
            description: 'Maximum number of pets to return.',
            required: false,
            schema: { type: 'integer', default: 10, minimum: 1, maximum: 100 },
          },
          {
            name: 'status',
            in: 'query',
            description: 'Only return pets in this state.',
            schema: { type: 'string', enum: ['available', 'pending', 'sold'], default: 'available' },
          },
          {
            name: 'X-Trace-Id',
            in: 'header',
            description: 'Optional trace identifier.',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          200: {
            description: 'A list of pets.',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
                example: [
                  { id: 1, name: 'Rex', status: 'available', tag: 'dog' },
                  { id: 2, name: 'Milo', status: 'pending', tag: 'cat' },
                ],
              },
            },
            headers: {
              'X-Total-Count': { description: 'Total pets matching the filter.', schema: { type: 'integer' } },
            },
          },
          422: { description: 'Validation error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      post: {
        tags: ['pets'],
        summary: 'Create a pet',
        operationId: 'create_pet',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/NewPet' },
              example: { name: 'Rex', status: 'available', tag: 'dog' },
            },
          },
        },
        responses: {
          201: { description: 'The created pet.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          401: { description: 'Missing or invalid token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/pets/{petId}': {
      get: {
        tags: ['pets'],
        summary: 'Get a pet by id',
        operationId: 'get_pet',
        parameters: [
          {
            name: 'petId',
            in: 'path',
            required: true,
            description: 'Numeric id of the pet.',
            schema: { type: 'integer', format: 'int64', minimum: 1 },
          },
          { name: 'session', in: 'cookie', description: 'Optional session cookie.', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'The requested pet.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          404: { description: 'Pet not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
      delete: {
        tags: ['pets'],
        summary: 'Delete a pet',
        operationId: 'delete_pet',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { 204: { description: 'Pet deleted.' } },
      },
    },
    '/auth/me': {
      get: {
        tags: ['auth'],
        summary: 'Read the current user',
        operationId: 'read_me',
        security: [{ bearerAuth: [] }],
        responses: {
          200: {
            description: 'The authenticated user.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    username: { type: 'string' },
                    scopes: { type: 'array', items: { type: 'string' }, examples: [['pets:read']] },
                    expires_at: { type: ['string', 'null'], format: 'date-time' },
                  },
                },
              },
            },
          },
          403: { description: 'Not enough permissions.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/health': {
      get: {
        tags: ['auth'],
        summary: 'Health check',
        security: [],
        responses: { 200: { description: 'Service is healthy.', content: { 'application/json': { example: { status: 'ok' } } } } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: 'object',
        title: 'Pet',
        required: ['id', 'name'],
        properties: {
          id: { type: 'integer', format: 'int64', readOnly: true, example: 1 },
          name: { type: 'string', maxLength: 64, example: 'Rex' },
          status: { type: 'string', enum: ['available', 'pending', 'sold'], default: 'available' },
          tag: { type: ['string', 'null'], description: 'Free-form label.' },
          owner: { $ref: '#/components/schemas/Owner' },
        },
      },
      NewPet: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', maxLength: 64 },
          status: { type: 'string', enum: ['available', 'pending', 'sold'], default: 'available' },
          tag: { type: ['string', 'null'] },
        },
      },
      Owner: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          pets: { type: 'array', items: { $ref: '#/components/schemas/Pet' }, description: 'Circular back-reference.' },
        },
      },
      Error: errorSchema,
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Paste a token from /auth/login.' },
    },
  },
});

/* -------------------------------- Express -------------------------------- */
writeYaml('express.yaml', {
  openapi: '3.0.3',
  info: { title: 'Express Users API', version: '2.4.1', description: 'Users service generated with swagger-jsdoc.' },
  servers: [{ url: 'http://localhost:4010', description: 'Local' }],
  tags: [{ name: 'users' }],
  paths: {
    '/users': {
      get: {
        tags: ['users'],
        summary: 'List users',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'role', in: 'query', schema: { type: 'string', enum: ['admin', 'member'] } },
        ],
        responses: {
          200: {
            description: 'Users',
            content: {
              'application/json': {
                schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                examples: {
                  twoUsers: { summary: 'Two users', value: [{ id: 'u_1', name: 'Ada', role: 'admin' }, { id: 'u_2', name: 'Linus', role: 'member' }] },
                },
              },
            },
          },
        },
      },
      post: {
        tags: ['users'],
        summary: 'Create a user',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/UserInput' } },
            'application/x-www-form-urlencoded': { schema: { $ref: '#/components/schemas/UserInput' } },
          },
        },
        responses: { 201: { description: 'Created' }, 409: { description: 'Email already registered' } },
      },
    },
    '/users/{id}': {
      patch: {
        tags: ['users'],
        summary: 'Update a user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          content: { 'application/json': { schema: { $ref: '#/components/schemas/UserInput' } } },
        },
        responses: {
          200: {
            description: 'Updated user',
            content: { 'application/json': { schema: { oneOf: [{ $ref: '#/components/schemas/User' }, { $ref: '#/components/schemas/Guest' }] } } },
          },
        },
      },
      delete: {
        tags: ['users'],
        summary: 'Delete a user',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 204: { description: 'Deleted' } },
      },
    },
  },
  components: {
    schemas: {
      User: {
        type: 'object',
        required: ['id', 'name', 'role'],
        properties: {
          id: { type: 'string', example: 'u_1' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'member'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      UserInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { type: 'string', enum: ['admin', 'member'], default: 'member' },
        },
      },
      Guest: {
        type: 'object',
        properties: { id: { type: 'string' }, expires_at: { type: 'string', format: 'date-time' } },
      },
    },
  },
});

/* --------------------------------- Flask --------------------------------- */
write('flask.json', {
  openapi: '3.0.2',
  info: { title: 'Flask Inventory', version: '0.9.0', description: 'Inventory service documented with flasgger.' },
  servers: [{ url: 'http://localhost:4010' }],
  tags: [{ name: 'inventory', description: 'Stock keeping.' }],
  paths: {
    '/items': {
      get: {
        tags: ['inventory'],
        summary: 'List inventory items',
        parameters: [{ name: 'q', in: 'query', description: 'Search term.', schema: { type: 'string' } }],
        responses: {
          200: { description: 'Items', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } } } } },
        },
      },
      post: {
        tags: ['inventory'],
        summary: 'Add an item',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['sku', 'quantity'],
                properties: {
                  sku: { type: 'string', pattern: '^[A-Z]{3}-\\d{3}$' },
                  quantity: { type: 'integer', minimum: 0 },
                  location: { type: 'string', default: 'main' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
          400: { description: 'Invalid payload' },
        },
      },
    },
    '/items/{sku}': {
      get: {
        tags: ['inventory'],
        summary: 'Read one item',
        parameters: [{ name: 'sku', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Item', content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } },
          404: { description: 'Not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        properties: {
          sku: { type: 'string', example: 'ABC-123' },
          name: { type: 'string' },
          quantity: { type: 'integer', example: 12 },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
    },
    securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
  },
  security: [{ apiKey: [] }],
});

/* --------------------------------- Django -------------------------------- */
writeYaml('django.yaml', {
  openapi: '3.0.3',
  info: { title: 'Django Shop API', version: '3.1.0', description: 'Storefront API produced by drf-spectacular.' },
  servers: [{ url: 'http://localhost:4010/api', description: 'API root' }],
  tags: [{ name: 'orders' }, { name: 'products' }],
  paths: {
    '/products/': {
      get: {
        tags: ['products'],
        summary: 'List products',
        responses: {
          200: {
            description: 'Products',
            content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } },
          },
        },
      },
    },
    '/orders/': {
      post: {
        tags: ['orders'],
        summary: 'Place an order',
        security: [{ jwtAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['items'],
                properties: {
                  items: {
                    type: 'array',
                    minItems: 1,
                    items: {
                      type: 'object',
                      required: ['product', 'quantity'],
                      properties: {
                        product: { type: 'integer' },
                        quantity: { type: 'integer', minimum: 1, maximum: 99 },
                      },
                    },
                  },
                  coupon: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'Order created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Order' } } } },
          400: { description: 'Bad request' },
        },
      },
    },
  },
  components: {
    schemas: {
      Product: {
        type: 'object',
        properties: {
          id: { type: 'integer', readOnly: true },
          name: { type: 'string' },
          price: { type: 'number', format: 'double', minimum: 0 },
          currency: { type: 'string', default: 'USD' },
        },
      },
      Order: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          total: { type: 'number' },
          status: { type: 'string', enum: ['pending', 'paid', 'shipped'] },
        },
      },
    },
    securitySchemes: { jwtAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
  },
});

/* --------------------------------- NestJS -------------------------------- */
write('nestjs.json', {
  openapi: '3.0.0',
  info: { title: 'NestJS Tasks', version: '1.2.0', description: 'Task board API generated by @nestjs/swagger.' },
  servers: [{ url: 'http://localhost:4010', description: 'Local' }],
  tags: [{ name: 'tasks' }],
  paths: {
    '/tasks': {
      get: {
        tags: ['tasks'],
        summary: 'List tasks',
        parameters: [
          { name: 'completed', in: 'query', schema: { type: 'boolean', default: false } },
          { name: 'assignee', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'Tasks', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Task' } } } } },
        },
      },
      post: {
        tags: ['tasks'],
        summary: 'Create a task',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTaskDto' } } } },
        responses: { 201: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Task' } } } } },
      },
    },
    '/tasks/{id}': {
      put: {
        tags: ['tasks'],
        summary: 'Replace a task',
        security: [{ bearer: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateTaskDto' } } } },
        responses: { 200: { description: 'Replaced' } },
      },
    },
  },
  components: {
    schemas: {
      CreateTaskDto: {
        type: 'object',
        required: ['title'],
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 120 },
          description: { type: 'string' },
          completed: { type: 'boolean', default: false },
          labels: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
      },
      Task: {
        allOf: [
          { $ref: '#/components/schemas/CreateTaskDto' },
          { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' } } },
        ],
      },
    },
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
  },
});

/* -------------------------------- Spring --------------------------------- */
write('spring.json', {
  openapi: '3.0.1',
  info: { title: 'Spring Pet Clinic', version: '4.0.0', description: 'Springdoc-generated API with server variables and basic auth.' },
  servers: [
    { url: '{protocol}://{host}:{port}/api', description: 'Generated server', variables: { protocol: { default: 'http', enum: ['http', 'https'] }, host: { default: 'localhost' }, port: { default: '4010' } } },
  ],
  tags: [{ name: 'owners' }],
  paths: {
    '/owners': {
      get: {
        tags: ['owners'],
        summary: 'List owners',
        parameters: [{ name: 'lastName', in: 'query', description: 'Filter by last name prefix.', schema: { type: 'string' } }],
        responses: {
          200: { description: 'Owners', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Owner' } } } } },
        },
      },
      post: {
        tags: ['owners'],
        summary: 'Create an owner',
        security: [{ basicAuth: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/OwnerInput' } } } },
        responses: { 200: { description: 'Created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Owner' } } } } },
      },
    },
    '/owners/{ownerId}': {
      get: {
        tags: ['owners'],
        summary: 'Find an owner',
        parameters: [{ name: 'ownerId', in: 'path', required: true, schema: { type: 'integer', format: 'int32' } }],
        responses: {
          200: { description: 'Owner', content: { 'application/json': { schema: { $ref: '#/components/schemas/Owner' } } } },
          404: { description: 'Not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      OwnerInput: {
        type: 'object',
        required: ['firstName', 'lastName'],
        properties: { firstName: { type: 'string' }, lastName: { type: 'string' }, telephone: { type: 'string', pattern: '\\d{10}' } },
      },
      Owner: {
        allOf: [
          { $ref: '#/components/schemas/OwnerInput' },
          { type: 'object', properties: { id: { type: 'integer', readOnly: true }, pets: { type: 'array', items: { type: 'string' } } } },
        ],
      },
    },
    securitySchemes: { basicAuth: { type: 'http', scheme: 'basic' } },
  },
});

/* -------------------------------- ASP.NET -------------------------------- */
write('aspnet.json', {
  openapi: '3.0.1',
  info: { title: 'ASP.NET Weather', version: '1.0.0', description: 'Weather API produced by Swashbuckle.' },
  servers: [{ url: 'http://localhost:4010' }],
  tags: [{ name: 'WeatherForecast' }],
  paths: {
    '/WeatherForecast': {
      get: {
        tags: ['WeatherForecast'],
        summary: 'Get the forecast',
        responses: {
          200: {
            description: 'Success',
            content: {
              'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/WeatherForecast' } } },
              'text/plain': { schema: { type: 'string' } },
            },
          },
        },
      },
    },
    '/WeatherForecast/{id}': {
      get: {
        tags: ['WeatherForecast'],
        summary: 'Get one forecast',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer', format: 'int32' } }],
        responses: {
          200: { description: 'Success', content: { 'application/json': { schema: { $ref: '#/components/schemas/WeatherForecast' } } } },
          404: { description: 'Not found', content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      WeatherForecast: {
        type: 'object',
        properties: {
          date: { type: 'string', format: 'date' },
          temperatureC: { type: 'integer', format: 'int32' },
          temperatureF: { type: 'integer', format: 'int32', readOnly: true },
          summary: { type: 'string', nullable: true },
        },
      },
      ProblemDetails: {
        type: 'object',
        properties: {
          type: { type: 'string', nullable: true },
          title: { type: 'string', nullable: true },
          status: { type: 'integer', format: 'int32', nullable: true },
          detail: { type: 'string', nullable: true },
        },
      },
    },
  },
});

/* ----------------------------------- Go ---------------------------------- */
write('go.json', {
  swagger: '2.0',
  info: { title: 'Go Orders API', version: '1.0.0', description: 'Orders service documented with go-swagger (Swagger 2.0).' },
  host: '127.0.0.1:4010',
  basePath: '/api/v1',
  schemes: ['http'],
  consumes: ['application/json'],
  produces: ['application/json'],
  tags: [{ name: 'orders' }],
  paths: {
    '/orders': {
      get: {
        tags: ['orders'],
        summary: 'List orders',
        operationId: 'listOrders',
        parameters: [
          { name: 'limit', in: 'query', type: 'integer', format: 'int64', default: 20, minimum: 1, maximum: 200 },
          { name: 'state', in: 'query', type: 'string', enum: ['open', 'paid', 'shipped'] },
        ],
        responses: {
          200: { description: 'Orders', schema: { type: 'array', items: { $ref: '#/definitions/Order' } } },
          500: { description: 'Server error', schema: { $ref: '#/definitions/Error' } },
        },
      },
      post: {
        tags: ['orders'],
        summary: 'Create an order',
        operationId: 'createOrder',
        security: [{ api_key: [] }],
        parameters: [
          { name: 'body', in: 'body', required: true, description: 'The order to create.', schema: { $ref: '#/definitions/NewOrder' } },
        ],
        responses: {
          201: { description: 'Created', schema: { $ref: '#/definitions/Order' } },
          401: { description: 'Unauthorized' },
        },
      },
    },
    '/orders/{orderId}': {
      get: {
        tags: ['orders'],
        summary: 'Get an order',
        operationId: 'getOrder',
        parameters: [{ name: 'orderId', in: 'path', type: 'string', required: true }],
        responses: {
          200: { description: 'Order', schema: { $ref: '#/definitions/Order' } },
          404: { description: 'Not found', schema: { $ref: '#/definitions/Error' } },
        },
      },
    },
    '/orders/{orderId}/attachments': {
      post: {
        tags: ['orders'],
        summary: 'Attach a receipt',
        operationId: 'attachReceipt',
        consumes: ['multipart/form-data'],
        parameters: [
          { name: 'orderId', in: 'path', type: 'string', required: true },
          { name: 'file', in: 'formData', type: 'file', required: true, description: 'Receipt file.' },
          { name: 'note', in: 'formData', type: 'string', description: 'Optional note.' },
        ],
        responses: { 202: { description: 'Accepted' } },
      },
    },
  },
  securityDefinitions: {
    api_key: { type: 'apiKey', name: 'X-API-Key', in: 'header', description: 'Service API key.' },
  },
  definitions: {
    Order: {
      type: 'object',
      required: ['id', 'total'],
      properties: {
        id: { type: 'string', example: 'ord_123' },
        total: { type: 'number', format: 'double', minimum: 0 },
        state: { type: 'string', enum: ['open', 'paid', 'shipped'] },
        items: { type: 'array', items: { $ref: '#/definitions/OrderItem' } },
      },
    },
    OrderItem: {
      type: 'object',
      properties: { sku: { type: 'string' }, quantity: { type: 'integer', minimum: 1 } },
    },
    NewOrder: {
      type: 'object',
      required: ['items'],
      properties: {
        items: { type: 'array', minItems: 1, items: { $ref: '#/definitions/OrderItem' } },
        note: { type: 'string' },
      },
    },
    Error: {
      type: 'object',
      properties: { message: { type: 'string' }, code: { type: 'integer' } },
    },
  },
});

/* ------------------------------ Edge cases -------------------------------- */
write('edge.json', {
  openapi: '3.1.0',
  info: { title: 'Edge Cases', version: '0.0.1', description: 'Recursive schemas, anyOf, const, and unusual parameter styles.' },
  paths: {
    '/tree': {
      post: {
        tags: ['edge'],
        summary: 'Build a tree',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Node' },
              examples: { sample: { value: { name: 'root', children: [{ name: 'leaf' }] } } },
            },
          },
        },
        responses: {
          200: {
            description: 'The same tree',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
          },
        },
      },
    },
    '/anything': {
      get: {
        tags: ['edge'],
        summary: 'Anything',
        parameters: [
          { name: 'ids', in: 'query', style: 'form', explode: true, schema: { type: 'array', items: { type: 'integer' } } },
          { name: 'X-Mode', in: 'header', required: true, schema: { const: 'fast' } },
        ],
        responses: {
          200: {
            description: 'A union',
            content: {
              'application/json': {
                schema: { anyOf: [{ $ref: '#/components/schemas/Node' }, { type: 'string' }, { type: 'null' }] },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Node: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
          meta: { type: 'object', additionalProperties: { type: 'string' } },
        },
      },
    },
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'session' },
      oauth: {
        type: 'oauth2',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://example.com/oauth/authorize',
            tokenUrl: 'https://example.com/oauth/token',
            scopes: { 'read:all': 'Read everything', 'write:all': 'Write everything' },
          },
        },
      },
    },
  },
});

console.log('Wrote OpenAPI fixtures to', outDir);
