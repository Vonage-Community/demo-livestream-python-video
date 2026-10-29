from fastapi import FastAPI, HTTPException 
from fastapi.staticfiles import StaticFiles 
from fastapi.templating import Jinja2Templates 
from fastapi.requests import Request
from fastapi.responses import HTMLResponse

from pydantic import BaseModel

from config import VONAGE_APPLICATION_ID, VONAGE_PRIVATE_KEY_PATH

from vonage import Vonage, Auth
from vonage_video import SessionOptions, MediaMode, TokenOptions, TokenRole
from vonage_video.models import (CreateBroadcastRequest,
                                 BroadcastOutputSettings,
                                 BroadcastHls,
                                 ComposedLayout,
                                 LayoutType,
                                 VideoResolution)

import logging

# Logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)


# Create a FastAPI app
app = FastAPI()
app.mount('/static', StaticFiles(directory='static'), name='static')
templates = Jinja2Templates(directory='templates')

# Create a Vonage video client
VONAGE_CLIENT = Vonage(
    Auth(
        application_id=VONAGE_APPLICATION_ID,
        private_key=VONAGE_PRIVATE_KEY_PATH,
    )
)
VONAGE_VIDEO = VONAGE_CLIENT.video

# In-memory storage for demo purposes only
SESSION = {'session_id': None,
           'broadcasts': {}} # { broadcast_id: { "name": "...", "hlsUrl": None } }

class StartBroadcastRequest(BaseModel):
    name: str

#Routes
@app.get('/')
async def index():
    logger.info("Getting index page ...")
    with open('templates/index.html') as f:
        return HTMLResponse(f.read())

@app.post('/session')
async def create_session():

    logger.info("Checking for existing session ...")

    # Only create a new session if one doesn't already exist
    if SESSION.get('session_id'):
        session_id = SESSION['session_id']
        
        logger.info(f"Found session: {session_id}")
        
        return {'status': 'ok', 'sessionId': session_id}

    session_options = SessionOptions(media_mode=MediaMode.ROUTED)
    session = VONAGE_VIDEO.create_session(session_options)
    session_id = session.session_id
    
    SESSION['session_id'] = session_id
    
    logger.info(f"Session: {session_id} successfully created and added to in-memory storage: {SESSION['session_id']}")
    
    return {'status': 'ok', 'sessionId': session_id}

@app.get('/token')
async def generate_token():

    session_id = SESSION.get('session_id', None)

    # A token cannot be generated if a session does not exist
    if not session_id:
        raise HTTPException(status_code=400, detail="No session exists. Call POST /session first.")

    token_options = TokenOptions(session_id=session_id, role=TokenRole.MODERATOR)
    token = VONAGE_VIDEO.generate_client_token(token_options).decode("utf-8")

    logger.info("Token successfully generated")
    
    return {'status': 'ok',
            'apiKey': VONAGE_APPLICATION_ID,
            'sessionId': session_id,
            'token': token}

@app.post("/broadcast/start")
async def start_broadcast(body: StartBroadcastRequest):

    logger.info("Starting broadcast ...")

    broadcast_name = body.name
    session_id = SESSION.get('session_id', None)

    # A broadcast cannot be started if a session does not exist
    if not session_id:
        raise HTTPException(status_code=400, detail="No session exists. Call POST /session first.")
    
    broadcast_options = CreateBroadcastRequest(
        session_id=session_id,
        outputs=BroadcastOutputSettings(
            hls=BroadcastHls()
        ),
        resolution=VideoResolution.RES_1280x720,
        layout=ComposedLayout(type=LayoutType.BEST_FIT),
        max_duration=14400,             # 4 hours in seconds
    )

    broadcast_response = VONAGE_VIDEO.start_broadcast(broadcast_options)

    broadcast_id = broadcast_response.id
    broadcast_status = broadcast_response.status
    
    SESSION['broadcasts'][broadcast_id] = {'name': broadcast_name, 'hlsUrl': None}

    logger.info(f"Broadcast: {broadcast_id} successfully started and added to in-memory storage: {SESSION['broadcasts'][broadcast_id]}")

    return {"broadcastId": broadcast_id, "name": broadcast_name, "status": broadcast_status}

@app.get('/broadcast/list')
async def broadcast_list():

    logger.info("Getting list of broadcasts ...")
    
    broadcast_list = [{'broadcastId': k, **v} for k, v in SESSION['broadcasts'].items()]

    return {"broadcasts": broadcast_list}

@app.get("/broadcast/status/{broadcast_id}")
async def start_status(broadcast_id: str):

    logger.info(f"Getting status of broadcast: {broadcast_id} ...")

    # If there is no broadcast id, then there can't be a broadcast status
    if broadcast_id not in SESSION['broadcasts']:
        raise HTTPException(status_code=404, detail=f"Broadcast id: {broadcast_id} is not currently running.")

    broadcast_response = VONAGE_VIDEO.get_broadcast(broadcast_id=broadcast_id)

    # If broadcast urls exists, then set hls_status; otherwise, the status is None
    hls_status = broadcast_response.broadcast_urls.hls_status if broadcast_response.broadcast_urls else None

    logger.info(f"Status of broadcast is: {hls_status} ...")
    
    hls_url = None

    # When the status is ready, set the hls url
    if hls_status == "ready":
        logger.info("Broadcast is ready!")
        hls_url = broadcast_response.broadcast_urls.hls

    return {
        "status": broadcast_response.status,       # "started" or "stopped"
        "hlsStatus": hls_status,          # "connecting", "ready"
        "hlsUrl": hls_url,
    }

# Stop a broadcast according to broadcast id
# Remove the broadcast from the in-memory storage
@app.post("/broadcast/stop/{broadcast_id}")
async def stop_broadcast(broadcast_id):
    
    logger.info(f"Stopping broadcast: {broadcast_id} ...")
    
    # Do not start a second broadcast if one is already running
    if broadcast_id not in SESSION['broadcasts']:
        raise HTTPException(status_code=404, detail=f"Broadcast id: {broadcast_id} is not currently running.")

    response_broadcast = VONAGE_VIDEO.stop_broadcast(broadcast_id=broadcast_id)

    response_broadcast_id = response_broadcast.id
    response_broadcast_status = response_broadcast.status

    logger.info(f"Broadcast: {broadcast_id} is now status: {response_broadcast_status}")

    # Remove the broadcast from the in-memory storage
    del SESSION['broadcasts'][response_broadcast_id]
    logger.info(f"Removed broadcast: {broadcast_id} from in-memory storage: {SESSION['broadcasts']}")

    return {"broadcastId": response_broadcast_id, "status": response_broadcast_status}