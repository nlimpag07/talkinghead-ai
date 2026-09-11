# Production-Ready AI Talking Head Web Assistant

You are an expert full-stack software architect and senior engineer.

Build a production-ready web application that provides a real-time AI talking-head assistant. The application should be modern, responsive, scalable, and follow best practices.

## Objective

Create a website where visitors can have a natural voice conversation with an AI human avatar.

The avatar should:

- Display on the page at all times.
- Listen when the user speaks.
- Understand the conversation.
- Respond naturally using AI.
- Speak with a realistic AI voice.
- Animate lips while speaking.
- Blink naturally.
- Show subtle idle animations.
- Display emotions when appropriate.
- Show live conversation text.

The interaction should feel similar to talking to a real receptionist or customer support representative.

## Technology Stack

- Next.js 15 (App Router)
- React
- TypeScript
- Tailwind CSS
- Radix UI
- React Three Fiber
- Three.js
- Framer Motion
- Node.js
- PostgreSQL
- Prisma ORM

Use clean architecture, reusable components, and strict TypeScript.

## AI

Use the OpenAI Realtime API for:
- Speech recognition
- Conversation
- Streaming responses
- Interruption support
- Low latency

## Voice

Support:
- Streaming text-to-speech
- Interruption
- Cancel speaking
- Resume naturally

## Avatar

Implement:
- Blinking
- Breathing
- Eye movement
- Lip sync
- Smiling
- Head movement
- Idle animation

## Conversation UI

Split layout:

Left:
- Large AI avatar

Right:
- Live chat conversation

Messages should stream while the AI is speaking.

## Voice Controls

- Start Conversation
- Stop Listening
- Mute
- Unmute
- End Conversation

Display microphone, speaking, and connection states.

## Features

- Voice Activity Detection
- Interrupt AI while speaking
- Conversation history
- Auto reconnect
- Typing indicator
- Streaming responses
- Token usage
- Conversation timer
- Latency indicator
- Audio level visualization

## Knowledge Base

Support:
- PDFs
- Website URLs
- Markdown
- FAQ
- Database

Implement Retrieval-Augmented Generation (RAG).

## Admin Panel

Include:
- Upload PDF/DOCX/TXT
- Add Website URL
- Delete knowledge
- Conversation logs
- Analytics
- Prompt editor
- Voice selection
- Avatar selection
- Theme customization

## Security

Implement:
- Authentication
- Rate limiting
- CSRF protection
- Input validation
- Secure API routes
- Error boundaries
- Logging
- Audit logs

## Database

Create Prisma models for:
- Users
- Sessions
- Conversations
- Messages
- KnowledgeBase
- Documents
- Analytics
- Settings
- Prompts

## API

Create REST endpoints for:
- conversation
- knowledge
- upload
- settings
- analytics
- voice
- avatar

## UI Design

Modern minimalist design:
- White background
- Soft shadows
- Rounded cards
- Smooth animations
- Responsive layout
- Professional typography
- Dark mode
- Light mode

## Folder Structure

Generate:
- app
- components
- hooks
- services
- lib
- utils
- types
- prisma
- api
- styles
- public

## Code Quality

Generate production-ready code with:
- No placeholders
- No TODOs
- Proper error handling
- Reusable hooks
- Strong typing
- Accessibility support
- Performance optimization

## Documentation

Include:
1. Folder structure
2. Installation guide
3. Environment variables
4. Database setup
5. Prisma migrations
6. OpenAI configuration
7. Running locally
8. Production deployment
9. Docker configuration
10. Troubleshooting

## Deliverables

Generate the project one file at a time.

For each file:
- Explain its purpose.
- Output the complete code.
- Ensure it compiles without modification.

Do not skip files.

Continue until the entire application is complete.

If the response reaches the token limit, stop naturally and continue from the next file in the following response without repeating previous code.
