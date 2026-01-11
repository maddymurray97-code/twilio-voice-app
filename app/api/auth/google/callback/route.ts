import { NextRequest, NextResponse } from 'next/server';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI;
const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;

export async function GET(req: NextRequest) {
  try {
    const searchParams = req.nextUrl.searchParams;
    const code = searchParams.get('code');
    const businessId = searchParams.get('state');
    
    if (!code) {
      return new NextResponse('Authorization code not found', { status: 400 });
    }
    
    console.log('📥 Received OAuth callback for business:', businessId);
    
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID!,
        client_secret: GOOGLE_CLIENT_SECRET!,
        code: code,
        redirect_uri: GOOGLE_REDIRECT_URI!,
        grant_type: 'authorization_code'
      })
    });
    
    const tokens = await tokenResponse.json();
    
    if (tokens.error) {
      console.error('Token error:', tokens);
      return new NextResponse(`Error: ${tokens.error_description}`, { status: 400 });
    }
    
    console.log('✅ Got OAuth tokens');
    
    const userResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    
    const user = await userResponse.json();
    console.log('👤 User:', user.email);
    
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000).toISOString().split('T')[0];
    
    if (businessId) {
      console.log('📤 Updating Airtable business:', businessId);
      console.log('📋 Update payload:', {
        'Calendar Type': 'Google Calendar',
        'Calendar Email': user.email,
        'Calendar Sync Enabled': true,
        tokenExpiry: expiryDate
      });
      
      const airtableResponse = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              'Calendar Type': 'Google Calendar',
              'Calendar Email': user.email,
              'Google Access Token': tokens.access_token,
              'Google Refresh Token': tokens.refresh_token,
              'Google Token Expiry': expiryDate,
              'Calendar Sync Enabled': true
            }
          })
        }
      );
      
      const airtableResult = await airtableResponse.json();
      console.log('📋 Airtable response status:', airtableResponse.status);
      console.log('📋 Airtable response:', airtableResult);
      
      if (!airtableResponse.ok) {
        console.error('❌ Airtable update failed:', airtableResult);
        return new NextResponse(
          `Airtable Error: ${JSON.stringify(airtableResult, null, 2)}`, 
          { status: 500, headers: { 'Content-Type': 'text/plain' } }
        );
      }
      
      console.log('✅ Updated Airtable with calendar credentials');
    }
    
    return new NextResponse(`
      <html>
        <head>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 3rem;
              border-radius: 12px;
              box-shadow: 0 10px 40px rgba(0,0,0,0.2);
              text-align: center;
              max-width: 400px;
            }
            h1 { color: #2d3748; margin-bottom: 1rem; }
            p { color: #4a5568; margin: 0.5rem 0; }
            .success { font-size: 4rem; margin-bottom: 1rem; }
            .email { 
              background: #edf2f7; 
              padding: 0.5rem 1rem; 
              border-radius: 6px; 
              margin: 1rem 0;
              font-family: monospace;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success">✅</div>
            <h1>Calendar Connected!</h1>
            <p>Your Google Calendar is now syncing.</p>
            <div class="email">${user.email}</div>
            <p style="margin-top: 2rem; color: #718096;">You can close this window.</p>
          </div>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
    
  } catch (error) {
    console.error('Callback error:', error);
    return new NextResponse(`Error: ${error instanceof Error ? error.message : String(error)}`, { status: 500 });
  }
}
