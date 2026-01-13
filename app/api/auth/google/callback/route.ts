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
          <meta charset="UTF-8">
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #CC785C 0%, #E07A5F 100%);
            }
            .container {
              background: white;
              padding: 3rem 2.5rem;
              border-radius: 16px;
              box-shadow: 0 20px 60px rgba(0,0,0,0.15);
              text-align: center;
              max-width: 480px;
            }
            .logo {
              width: 60px;
              height: 60px;
              background: linear-gradient(135deg, #CC785C 0%, #E07A5F 100%);
              border-radius: 50%;
              margin: 0 auto 1.5rem;
              display: flex;
              align-items: center;
              justify-content: center;
            }
            .checkmark {
              width: 30px;
              height: 30px;
              border: 3px solid white;
              border-radius: 50%;
              position: relative;
            }
            .checkmark:after {
              content: '';
              position: absolute;
              left: 8px;
              top: 4px;
              width: 8px;
              height: 14px;
              border: solid white;
              border-width: 0 3px 3px 0;
              transform: rotate(45deg);
            }
            h1 { 
              color: #1a202c; 
              margin-bottom: 0.5rem;
              font-size: 1.75rem;
              font-weight: 600;
            }
            .subtitle {
              color: #718096;
              margin-bottom: 1.5rem;
              font-size: 1rem;
            }
            .email-box { 
              background: #f7fafc; 
              padding: 1rem 1.25rem; 
              border-radius: 8px; 
              margin: 1.5rem 0;
              font-family: 'SF Mono', Monaco, monospace;
              color: #2d3748;
              font-size: 0.95rem;
              border: 1px solid #e2e8f0;
            }
            .info {
              color: #4a5568;
              font-size: 0.9rem;
              line-height: 1.6;
              margin: 1.5rem 0;
            }
            .close-text {
              margin-top: 2rem;
              color: #a0aec0;
              font-size: 0.875rem;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="logo">
              <div class="checkmark"></div>
            </div>
            <h1>Calendar Successfully Connected</h1>
            <p class="subtitle">Your appointments will now sync automatically</p>
            <div class="email-box">${user.email}</div>
            <p class="info">
              We'll automatically check your calendar for upcoming appointments and send reminder texts to your customers 24 hours and 1 hour before their scheduled time.
            </p>
            <p class="close-text">You can safely close this window</p>
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
