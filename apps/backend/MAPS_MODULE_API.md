# Maps Module - API Documentation

## Overview
This module provides geolocation services for PLs (Puntos de Luz) with automatic geocoding and nearby location search capabilities.

## Endpoints

### 1. GET /codes/pl/:code
Get a PL by code with automatic geocoding if needed.

**Request:**
- **URL Parameters:**
  - `code` (string, required): PL code. Accepts formats like "PL/12345/..." or just "12345"

**Example Requests:**
```
GET /codes/pl/12345
GET /codes/pl/PL/12345/ABC
```

**Success Response (200):**
```json
{
  "id": 123,
  "code": "12345",
  "razon_social": "Example Company",
  "estado": "Jalisco",
  "municipio": "Guadalajara",
  "direccion": "Calle Principal 123, Col. Centro",
  "lat": 20.6597,
  "lon": -103.3496,
  "grupo_id": 1,
  "encargado_actual": "Juan Pérez",
  "formatted_address": "Calle Principal 123, Col. Centro, Guadalajara, Jalisco, México",
  "m13": false,
  "calibracion": "S",
  "created_at": "2024-01-15T10:30:00.000Z",
  "updated_at": "2024-01-20T14:45:00.000Z"
}
```

**Error Responses:**

- **404 Not Found** - PL not found or marked as baja:
```json
{
  "statusCode": 404,
  "message": "PL 12345 not found or is marked as baja"
}
```

- **404 Not Found** - Invalid code format:
```json
{
  "statusCode": 404,
  "message": "Invalid code format"
}
```

---

### 2. GET /codes/pl/nearby
Find nearby PLs within a specified radius.

**Request:**
- **Query Parameters:**
  - `code` (string, required): Base PL code to search from
  - `radiusKm` (number, optional): Search radius in kilometers. Default: 5

**Example Requests:**
```
GET /codes/pl/nearby?code=12345
GET /codes/pl/nearby?code=12345&radiusKm=10
GET /codes/pl/nearby?code=PL/12345/ABC&radiusKm=2.5
```

**Success Response (200):**
```json
{
  "base": {
    "id": 123,
    "code": "12345",
    "razon_social": "Base Company",
    "estado": "Jalisco",
    "municipio": "Guadalajara",
    "direccion": "Calle Principal 123",
    "lat": 20.6597,
    "lon": -103.3496,
    "grupo_id": 1,
    "encargado_actual": "Juan Pérez",
    "formatted_address": "Calle Principal 123, Guadalajara, Jalisco, México",
    "m13": false,
    "calibracion": "S",
    "created_at": "2024-01-15T10:30:00.000Z",
    "updated_at": "2024-01-20T14:45:00.000Z"
  },
  "radiusKm": 5,
  "count": 3,
  "nearby": [
    {
      "id": 124,
      "code": "12346",
      "razon_social": "Nearby Company 1",
      "estado": "Jalisco",
      "municipio": "Guadalajara",
      "direccion": "Av. Secundaria 456",
      "lat": 20.6612,
      "lon": -103.3489,
      "grupo_id": 1,
      "encargado_actual": "María López",
      "formatted_address": "Av. Secundaria 456, Guadalajara, Jalisco, México",
      "m13": true,
      "calibracion": "R",
      "created_at": "2024-01-10T08:00:00.000Z",
      "updated_at": "2024-01-18T12:30:00.000Z",
      "distanceKm": 0.21
    },
    {
      "id": 125,
      "code": "12347",
      "razon_social": "Nearby Company 2",
      "estado": "Jalisco",
      "municipio": "Guadalajara",
      "direccion": "Calle Tercera 789",
      "lat": 20.6654,
      "lon": -103.3512,
      "grupo_id": 2,
      "encargado_actual": "Pedro González",
      "formatted_address": "Calle Tercera 789, Guadalajara, Jalisco, México",
      "m13": false,
      "calibracion": null,
      "created_at": "2024-01-12T09:15:00.000Z",
      "updated_at": "2024-01-19T16:20:00.000Z",
      "distanceKm": 0.67
    },
    {
      "id": 126,
      "code": "12348",
      "razon_social": "Nearby Company 3",
      "estado": "Jalisco",
      "municipio": "Guadalajara",
      "direccion": "Boulevard Cuarto 101",
      "lat": 20.6489,
      "lon": -103.3423,
      "grupo_id": 1,
      "encargado_actual": "Ana Martínez",
      "formatted_address": "Boulevard Cuarto 101, Guadalajara, Jalisco, México",
      "m13": false,
      "calibracion": "S",
      "created_at": "2024-01-14T11:00:00.000Z",
      "updated_at": "2024-01-21T13:40:00.000Z",
      "distanceKm": 1.45
    }
  ]
}
```

**Error Responses:**

- **404 Not Found** - Base PL not found or marked as baja:
```json
{
  "statusCode": 404,
  "message": "PL 12345 not found or is marked as baja"
}
```

- **422 Unprocessable Entity** - Cannot determine coordinates for base PL:
```json
{
  "statusCode": 422,
  "message": "Cannot determine coordinates for PL 12345. No address available for geocoding."
}
```

---

## Features

### Geocoding
- **Automatic geocoding**: If a PL has an address but no coordinates, the system will automatically attempt to geocode it
- **Provider fallback**: 
  1. First tries Nominatim (OpenStreetMap) - free, no API key required
  2. Falls back to Google Maps if GEOCODING_API_KEY is configured
- **Rate limiting**: Nominatim requests are rate-limited to 1 request per second
- **Caching**: All geocoding results are cached to avoid repeated API calls

### Distance Calculation
- Uses **Haversine formula** implemented directly in PostgreSQL for efficient distance calculations
- Returns distances in kilometers with 2 decimal precision
- Results sorted by distance (nearest first)

### Security & Filters
- **Excludes baja records**: All queries automatically exclude PLs marked with `baja = true`
- **Coordinates required**: The `nearby` endpoint requires coordinates for the base PL and only searches among PLs with coordinates

### Performance
- **Partial index**: Database has a partial index on `(lat, lon)` for PLs with coordinates
- **Code index**: Quick lookups by code
- **Geocoding cache**: Prevents redundant API calls for the same addresses

---

## Database Schema

### Indexes
```sql
-- Unique index on code for fast lookups
CREATE UNIQUE INDEX ux_codes_code ON codes(code);

-- Standard index on code
CREATE INDEX ix_codes_code ON codes(code);

-- Partial index on lat/lon for nearby queries (only where coordinates exist)
CREATE INDEX ix_codes_lat_lon ON codes(lat, lon) WHERE lat IS NOT NULL AND lon IS NOT NULL;
```

### Geocoding Cache
The `geocode_cache` table stores geocoding results to minimize API calls:
- `address_hash`: Unique hash of the normalized address
- `provider`: 'nominatim' or 'google'
- `status`: Result status (e.g., 'OK', 'NOT_FOUND')
- `lat`, `lon`: Geocoded coordinates
- `refreshed_at`: Last time the cache entry was validated

---

## Environment Variables

### Optional
- `GEOCODING_API_KEY`: Google Maps API key. If not provided, only Nominatim will be used (which is free but has rate limits)

---

## Error Handling

All endpoints return appropriate HTTP status codes:
- `200 OK`: Successful request
- `404 Not Found`: PL not found or invalid code format
- `422 Unprocessable Entity`: Cannot determine coordinates (no address available for geocoding)
- `500 Internal Server Error`: Unexpected server error

Error responses follow NestJS standard format with `statusCode` and `message` fields.
