import { NextRequest, NextResponse } from 'next/server';

const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID;
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const MICROSOFT_REDIRECT_URI = process.env.MICROSOFT_REDIRECT_URI;
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
    
    // Exchange code for tokens
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID!,
        client_secret: MICROSOFT_CLIENT_SECRET!,
        code: code,
        redirect_uri: MICROSOFT_REDIRECT_URI!,
        grant_type: 'authorization_code',
        scope: 'https://graph.microsoft.com/Calendars.Read offline_access'
      })
    });
    
    const tokens = await tokenResponse.json();
    
    if (tokens.error) {
      console.error('Token error:', tokens);
      return new NextResponse(`Error: ${tokens.error_description}`, { status: 400 });
    }
    
    console.log('✅ Got OAuth tokens');
    
    // Get user info
    const userResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { 'Authorization': `Bearer ${tokens.access_token}` }
    });
    
    const user = await userResponse.json();
    console.log('👤 User:', user.mail || user.userPrincipalName);
    
    // Calculate token expiry
    const expiryDate = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
    
    // Update Airtable business record
    if (businessId) {
      await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/Businesses/${businessId}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            fields: {
              'Calendar Type': 'Microsoft 365',
              'Calendar Email': user.mail || user.userPrincipalName,
              'Microsoft Access Token': tokens.access_token,
              'Microsoft Refresh Token': tokens.refresh_token,
              'Microsoft Token Expiry': expiryDate,
              'Calendar Sync Enabled': true
            }
          })
        }
      );
      
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
            <p>Your Microsoft 365 calendar is now syncing.</p>
            <div class="email">${user.mail || user.userPrincipalName}</div>
            <p style="margin-top: 2rem; color: #718096;">You can close this window.</p>
          </div>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
    
  } catch (error) {
    console.error('Callback error:', error);
    return new NextResponse('Authentication failed', { status: 500 });
  }
}
