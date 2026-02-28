# Geocode Missing Endpoint Documentation

## Overview
This endpoint provides high-performance batch geocoding functionality to populate missing latitude and longitude coordinates in the `codes` table using Google Geocoding API with concurrent processing and address fallback.

## Endpoint
```
POST /codes/tools/geocode-missing
```

### Query Parameters
- `limit` (optional, number): Maximum number of codes to process. Default: 200, Max: 1000
- `startId` (optional, number): Starting ID for pagination/resuming. Default: 0

### Example Requests
```bash
# Process first 200 codes
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=200"

# Resume from a specific ID
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=200&startId=12345"

# Process smaller batch
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=50"
```

## Performance Characteristics

### Concurrent Processing
- **Concurrency**: 20 codes processed in parallel
- **Batch Processing**: Uses `Promise.allSettled` for efficient parallel execution
- **Speed**: ~10-20x faster than sequential processing
- **Estimated Time**: 
  - 200 codes: ~10-20 seconds (vs. ~40 seconds sequential)
  - 1000 codes: ~50-100 seconds (vs. ~3.3 minutes sequential)

### Rate Limiting
- No artificial delays between requests (relies on natural API rate limits)
- Automatic retry on rate limit (429/OVER_QUERY_LIMIT) errors
- Exponential backoff: 500ms, 1s, 2s, 4s, 8s
- Up to 5 retry attempts per address fallback level

## Functionality

### Selection Criteria
The endpoint selects codes that meet ALL of the following conditions:
- `id > startId` (for pagination)
- `lat IS NULL` OR `lon IS NULL`
- `baja != true` (not marked as inactive)
- `estado` is not empty or null
- Results ordered by `id ASC` for consistent pagination

### Address Fallback Strategy
For each code, the endpoint tries three address formats in order:

**Level A: Full Address**
```
{direccion}, {municipio}, {estado}, Mexico
```
*Used when all three fields are available*

**Level B: Municipio + Estado**
```
{municipio}, {estado}, Mexico
```
*Used if Level A fails or direccion is missing*

**Level C: Estado Only**
```
{estado}, Mexico
```
*Used if Levels A and B fail or municipio is missing*

This fallback strategy ensures maximum success rate, especially for codes with incomplete address information.

### Geocoding Process
For each selected code:
1. **Address Construction**: Builds up to 3 address variants based on available data
2. **Concurrent Processing**: Processes 20 codes simultaneously using Promise.allSettled
3. **API Call**: Uses Google Geocoding API with:
   - `region=mx`
   - `language=es`
   - `components=country:MX`
4. **Cache Check**: Checks `geocode_cache` table first to avoid redundant API calls
5. **Retry Logic**: 
   - Up to 5 retries per address level on rate limit or network errors
   - Exponential backoff: 500ms, 1s, 2s, 4s, 8s
6. **Fallback**: If current address fails, tries next fallback level
7. **Result Handling**:
   - **Success**: Updates `lat`, `lon`, and `formatted_address` in database
   - **Failure**: Logs error, moves to next code, never throws 500 error

## Response Format

### Success Response (200 OK)
```json
{
  "processed": 200,
  "updated": 178,
  "failed": 22,
  "retried": 15,
  "overLimitCount": 3,
  "lastIdProcessed": "12545",
  "elapsedMs": 12500,
  "sampleUpdated": [
    {
      "code": "PL/12345",
      "status": "updated",
      "lat": 19.4326,
      "lon": -99.1332,
      "address": "Av. Insurgentes Sur 1234, CDMX, Ciudad de México, Mexico"
    }
  ],
  "sampleFailed": [
    {
      "code": "PL/67890",
      "status": "failed",
      "reason": "ZERO_RESULTS",
      "address": "Unknown State, Mexico"
    }
  ]
}
```

### Field Descriptions
- `processed`: Total number of codes processed in this batch
- `updated`: Number of codes successfully geocoded and updated
- `failed`: Number of codes that failed geocoding (all fallbacks failed)
- `retried`: Number of codes that required one or more retries
- `overLimitCount`: Number of codes that hit rate limit errors
- `lastIdProcessed`: ID of the last code processed (use as `startId` to continue)
- `elapsedMs`: Total processing time in milliseconds
- `sampleUpdated`: Array of up to 10 successful geocoding samples
- `sampleFailed`: Array of up to 10 failed geocoding samples

### Sample Object Fields
- `code`: The code identifier
- `status`: Either "updated" or "failed"
- `lat`: Latitude (only for updated)
- `lon`: Longitude (only for updated)
- `reason`: Failure reason (only for failed)
- `address`: The address that was geocoded (including fallback level used)

## Configuration

### Environment Variables
Required environment variable:
```
GEOCODING_API_KEY=your_google_maps_api_key_here
```

If the API key is not set, the geocoding service will fall back to Nominatim (free OpenStreetMap service).

## Implementation Details

### Database Updates
The endpoint:
1. Checks the `geocode_cache` table first for cached results
2. Calls Google Maps Geocoding API with address fallback
3. Falls back to Nominatim API if Google API key is not available
4. Updates both the `codes` table and `geocode_cache` table on success
5. Caches failed results to avoid redundant API calls

### Pagination/Resuming
To process large datasets in chunks:

```bash
# First batch
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=200"
# Returns: { ..., "lastIdProcessed": "12200", ... }

# Second batch (resume from last ID)
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=200&startId=12200"
# Returns: { ..., "lastIdProcessed": "12400", ... }

# Continue until processed < limit (no more records)
```

### Safety Features
1. **No Exceptions**: Never throws 500 errors for bad addresses
2. **Graceful Degradation**: Falls back through address levels automatically
3. **Cache Usage**: Reuses previous geocoding results when available
4. **Automatic Retry**: Handles temporary failures automatically
5. **Concurrent Safety**: Uses Promise.allSettled to prevent one failure from stopping the batch

## Use Cases

### Initial Data Import
```bash
# Process all records in batches of 500
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=500"
```

### Resume After Interruption
```bash
# Continue from where you left off
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=500&startId=25000"
```

### Rate Limit Recovery
If you hit rate limits, wait a few minutes and resume:
```bash
# Wait 5 minutes, then resume
curl -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=100&startId=12345"
```

### Process Entire Dataset
```bash
#!/bin/bash
# Script to process all records
LAST_ID=0
while true; do
  echo "Processing from ID: $LAST_ID"
  RESPONSE=$(curl -s -X POST "http://localhost:3000/codes/tools/geocode-missing?limit=200&startId=$LAST_ID")
  PROCESSED=$(echo $RESPONSE | jq -r '.processed')
  LAST_ID=$(echo $RESPONSE | jq -r '.lastIdProcessed')
  
  echo "Processed: $PROCESSED, Last ID: $LAST_ID"
  
  # If processed less than limit, we're done
  if [ "$PROCESSED" -lt 200 ]; then
    echo "Finished!"
    break
  fi
  
  # Optional: sleep between batches to avoid rate limits
  sleep 2
done
```

## Performance Comparison

### Before (Sequential)
- Processing: 1 code at a time
- Rate limit: 200ms delay between requests
- 200 codes: ~40 seconds
- 1000 codes: ~200 seconds (3.3 minutes)

### After (Concurrent)
- Processing: 20 codes in parallel
- Rate limit: Natural API limits with retry
- 200 codes: ~10-20 seconds (**2-4x faster**)
- 1000 codes: ~50-100 seconds (**2-4x faster**)

## Error Handling

### Rate Limit Errors (429/OVER_QUERY_LIMIT)
- Automatically retried up to 5 times per address level
- Exponential backoff prevents overwhelming the API
- Tracked in `overLimitCount` metric
- Falls back to next address level if all retries fail

### Address Not Found (ZERO_RESULTS)
- Automatically tries next address fallback level
- Level A → Level B → Level C
- Only marked as failed if all levels fail

### Network Errors
- Automatically retried with exponential backoff
- Falls back to next address level after max retries
- Tracked in `retried` metric

## Notes
- This endpoint is designed for batch operations and admin use
- For real-time geocoding of individual codes, use `/codes/:id/geocode`
- Results are cached to avoid redundant API calls
- The endpoint is idempotent - running it multiple times won't re-geocode already processed codes
- Use `startId` parameter to implement checkpointing in long-running jobs

## Monitoring

### Key Metrics to Watch
- `updated / processed`: Success rate (should be > 80%)
- `overLimitCount`: Rate limit hits (should be low, increase delays if high)
- `retried`: Retry count (indicates API instability if too high)
- `elapsedMs / processed`: Average time per code (should be ~50-100ms)

### Example Success Scenario
```json
{
  "processed": 200,
  "updated": 185,      // 92.5% success rate
  "failed": 15,
  "retried": 8,        // 4% retry rate (acceptable)
  "overLimitCount": 2, // 1% rate limit (acceptable)
  "elapsedMs": 15000   // 75ms per code (good)
}
```

### Example Problem Scenario
```json
{
  "processed": 200,
  "updated": 50,       // 25% success rate (investigate addresses)
  "failed": 150,
  "retried": 120,      // 60% retry rate (API issues?)
  "overLimitCount": 80, // 40% rate limit (too fast, reduce concurrency)
  "elapsedMs": 90000   // 450ms per code (too slow)
}
```
