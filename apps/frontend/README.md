# Codes Frontend

Frontend application for managing codes and locations with Google Maps integration.

## Prerequisites

- Node.js 18+ 
- npm or yarn
- Google Maps API key

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   - Copy `.env.example` to `.env.local`
   - Add your Google Maps API key to `.env.local`
   
   ```bash
   cp .env.example .env.local
   ```
   
   Then edit `.env.local` and replace `your_google_maps_api_key_here` with your actual API key.

### Getting a Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Enable the following APIs:
   - Maps JavaScript API
   - Geocoding API
4. Go to Credentials and create an API Key
5. Copy the API key to your `.env.local` file

## Development

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Build

Build the application for production:

```bash
npm run build
```

## Production

Start the production server:

```bash
npm start
```

## Environment Variables

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` - Required for Google Maps functionality (maps display and geocoding)
