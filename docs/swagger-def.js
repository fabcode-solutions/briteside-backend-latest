import fs from 'node:fs';
import env from '../src/config/config.js';
import SwaggerGenerator from '../src/utils/swagger-generator.js';

const packageData = JSON.parse(fs.readFileSync('./package.json'));

const generateSwaggerDef = async () => {
  const generator = new SwaggerGenerator();
  const { paths, components } = await generator.generate();

  return {
    openapi: '3.0.0',
    info: {
      title: 'GoKyro Event Management API',
      version: packageData.version,
      description: 'Comprehensive API for GoKyro event management platform with social features',
      contact: {
        name: 'GoKyro API Support',
        email: 'support@gokyro.com',
      },
    },
    servers: [
      {
        url: `${env.apiHost}/api`,
        description: 'Production server',
      },
    ],
    paths,
    components,
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization',
      },
      { name: 'Users', description: 'User management' },
      { name: 'Events', description: 'Event management' },
      { name: 'Groups', description: 'Group management' },
      { name: 'Tickets', description: 'Ticket management' },
      { name: 'Venues', description: 'Venue management' },
      { name: 'Categories', description: 'Category management' },
      { name: 'Organizers', description: 'Organizer management' },
      { name: 'Upload', description: 'File upload operations' },
      { name: 'Social', description: 'Social media features' },
      { name: 'Reviews', description: 'Review and rating system' },
      { name: 'Analytics', description: 'Analytics and reporting' },
      { name: 'Stream', description: 'Live streaming and calls' },
      { name: 'Ticket Scanning', description: 'Ticket scanning operations' },
      { name: 'Orders', description: 'Order management' },
      { name: 'Payment', description: 'Payment processing and refunds' },
      { name: 'Notifications', description: 'User notifications' },
      { name: 'Reports', description: 'Report management' },
    ],
  };
};

export default generateSwaggerDef;
