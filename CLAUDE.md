# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NextChat is a multi-provider AI chat application built with Next.js 14 that provides a universal interface for 15+ LLM providers (OpenAI, Claude, Gemini, DeepSeek, etc.). It features text/vision/voice chat, real-time conversations, artifacts, MCP (Model Context Protocol) integration, and cross-platform support via Tauri desktop app.

## Development Commands

```bash
# Core development
yarn dev                    # Start development server with mask watching
yarn build                  # Production build (standalone mode)
yarn start                  # Start production server
yarn lint                   # ESLint code checking

# Mask system (prompt templates)
yarn mask                   # Build mask templates
yarn mask:watch            # Watch mask files for changes

# Desktop app (Tauri)
yarn app:dev               # Desktop app development
yarn app:build             # Build desktop app
yarn app:clear            # Clear Tauri dev

# Testing
yarn test                   # Run tests in watch mode
yarn test:ci               # Run tests in CI mode

# Deployment variants
yarn export                # Static export build
yarn export:dev            # Development with export mode

# Utilities
yarn prompts               # Fetch external prompts
yarn proxy-dev            # Development with proxy setup
```

## Architecture

### Next.js App Router Structure
- **app/page.tsx** - Root application entry point
- **app/api/[provider]/route.ts** - API routes for each LLM provider (OpenAI, Claude, etc.)
- **app/components/** - React components for chat UI, settings, artifacts
- **app/client/** - Client-side API abstraction layer with universal provider interface

### Client-Server Communication
- **app/client/api.ts** - Main API client with unified interface for all providers
- **app/client/platforms/** - Provider-specific implementations
- **app/api/common.ts** - Shared server utilities and middleware
- Each provider has dedicated API route in **app/api/[provider]/**

### State Management (Zustand)
- **app/store/chat.ts** - Chat sessions, messages, and conversation state
- **app/store/config.ts** - Application configuration and settings
- **app/store/access.ts** - API keys and authentication state
- **app/store/mask.ts** - Prompt templates and mask system

### Key Features Architecture
- **app/mcp/** - Model Context Protocol implementation for tool integration
- **app/components/realtime-chat/** - Real-time voice chat with WebSocket connections
- **app/components/artifacts.tsx** - Code artifacts rendering and execution
- **app/masks/** - Prompt template system with build-time compilation
- **src-tauri/** - Rust-based desktop app wrapper

## Development Patterns

### Adding New LLM Provider
1. Create **app/api/[provider]/route.ts** for server-side API handling
2. Add client implementation in **app/client/platforms/[provider].ts**
3. Update **app/client/api.ts** to include new provider
4. Add provider configuration in **app/store/config.ts**

### Component Development
- Use module SCSS for styling (e.g., **component.module.scss**)
- Follow existing patterns in **app/components/** for consistency
- Utilize **app/components/ui-lib.tsx** for common UI components
- Maintain internationalization with **app/locales/**

### Testing
- Tests in **test/** directory using Jest and Testing Library
- Focus on model availability, provider functionality, and core utilities
- Run `yarn test` for development, `yarn test:ci` for CI pipeline

## Configuration

### Environment Variables
Extensive provider configuration required:
- OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.
- BUILD_MODE: 'standalone' (default) or 'export'
- ENABLE_MCP: Enable Model Context Protocol features

### Build Modes
- **Standalone**: Full Next.js app with API routes (default)
- **Export**: Static build for deployment without server
- **Desktop**: Tauri-wrapped desktop application

## Special Considerations

### Mask System
- Prompt templates in **app/masks/** are built at compile time
- Use `yarn mask:watch` during development for live updates
- Templates support multiple languages and dynamic content

### MCP Integration
- **app/mcp/client.ts** handles MCP server connections
- **app/mcp/types.ts** defines protocol interfaces
- Enable with ENABLE_MCP environment variable

### Proxy Configuration
- **app/api/proxy.ts** handles API proxying for provider requests
- Supports custom proxy configurations for different deployment environments