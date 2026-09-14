import { DemoSessionService, DemoRegistrationService } from '../services/demo.service.js';

export const demoController = {
  async createSession(req, res) {
    try {
      const session = await DemoSessionService.create(req.body);
      res.status(201).json({ success: true, data: session });
    } catch (error) {
      console.error('Demo session create error:', error);
      res.status(500).json({ error: error.message || 'Failed to create demo session' });
    }
  },

  async listSessions(req, res) {
    try {
      const { page = 1, limit = 20, status } = req.query;
      const sessions = await DemoSessionService.list({
        page: Number(page),
        limit: Number(limit),
        status,
      });
      res.json({ success: true, data: sessions });
    } catch (error) {
      console.error('Demo session list error:', error);
      res.status(500).json({ error: error.message || 'Failed to list demo sessions' });
    }
  },

  async listRegistrations(req, res) {
    try {
      const { sessionId } = req.params;
      const { page = 1, limit = 50 } = req.query;
      const registrations = await DemoRegistrationService.listBySession(sessionId, {
        page: Number(page),
        limit: Number(limit),
      });
      res.json({ success: true, data: registrations });
    } catch (error) {
      console.error('Demo registrations list error:', error);
      res.status(500).json({ error: error.message || 'Failed to list registrations' });
    }
  },

  async getUpcoming(req, res) {
    try {
      const { type } = req.query;
      const session = await DemoSessionService.getNextUpcoming({ sessionType: type });
      res.json({ success: true, data: session });
    } catch (error) {
      res.status(500).json({ error: error.message || 'Failed to fetch upcoming session' });
    }
  },

  async register(req, res) {
    try {
      const { sessionId } = req.params;
      await DemoRegistrationService.register(sessionId, req.body);
      res.status(201).json({ success: true });
    } catch (error) {
      console.error('Demo registration error:', error);
      const status = error.message === 'Demo session not found' ? 404 : 500;
      res.status(status).json({ error: error.message || 'Failed to register for demo' });
    }
  },

  async updateStatus(req, res) {
    try {
      const { sessionId } = req.params;
      const { status } = req.body;
      const session = await DemoSessionService.updateStatus(sessionId, status);
      if (!session) return res.status(404).json({ error: 'Demo session not found' });
      res.json({ success: true, data: session });
    } catch (error) {
      console.error('Demo session status update error:', error);
      res.status(500).json({ error: error.message || 'Failed to update session status' });
    }
  },

  async updateSession(req, res) {
    try {
      const { sessionId } = req.params;
      const session = await DemoSessionService.update(sessionId, req.body);
      if (!session) return res.status(404).json({ error: 'Demo session not found' });
      res.json({ success: true, data: session });
    } catch (error) {
      console.error('Demo session update error:', error);
      res.status(500).json({ error: error.message || 'Failed to update demo session' });
    }
  },

  async deleteSession(req, res) {
    try {
      const { sessionId } = req.params;
      const deleted = await DemoSessionService.delete(sessionId);
      if (!deleted) return res.status(404).json({ error: 'Demo session not found' });
      res.json({ success: true });
    } catch (error) {
      console.error('Demo session delete error:', error);
      res.status(500).json({ error: error.message || 'Failed to delete demo session' });
    }
  },
};
