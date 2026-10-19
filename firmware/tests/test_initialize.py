import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('initialize',Path(__file__).resolve().parents[1]/'portable/initialize.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
vectors=json.loads(Path(sys.argv.pop()).read_text())
DEVICE='11111111-1111-1111-1111-111111111111'

class Link:
    def __init__(self, **unused):
        self.lines=[b'PC_INIT_READY '+b'a'*32+b' 112233445566\n',('PC_INIT_OK '+DEVICE+'\n').encode()]
        self.sent=[]
    def open(self):pass
    def close(self):pass
    def flush(self):pass
    def readline(self,unused):return self.lines.pop(0) if self.lines else b''
    def write(self,value):self.sent.append(value)

class Response:
    def __init__(self,value):self.value=value
    def __enter__(self):return self
    def __exit__(self,*unused):pass
    def read(self,unused):return json.dumps(self.value).encode()

class Initialization(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.root=Path(self.temporary.name)
        self.profile=self.root/'event.json';self.profile.write_text(json.dumps({'origin':'https://example.test','enrollment_key':'b'*64}))
        self.identity=self.root/'identity.json';self.identity.write_text(json.dumps({'board_uid':'112233445566','device_id':DEVICE,'device_token':'a'*64,'server_origin':'https://example.test'}))
        self.link=Link();self.response=vectors['enrollment_waiting'];self.calls=0
    def tearDown(self):self.temporary.cleanup()
    def run_tool(self):
        def open_request(request,**unused):
            self.calls+=1
            self.assertEqual(json.loads(request.data)['device_id'],DEVICE)
            self.assertEqual(request.get_header('Authorization'),'Enrollment '+'b'*64)
            return Response(self.response)
        with patch.dict(sys.modules,{'serial':types.SimpleNamespace(Serial=lambda **kw:self.link)}),patch.object(module.urllib.request,'build_opener',return_value=types.SimpleNamespace(open=open_request)):
            module.initialize('TEST',self.profile,self.identity)
    def test_registered_identity_sent_only_after_verified_response(self):
        self.run_tool();self.assertEqual(len(self.link.sent),1)
        command=json.loads(self.link.sent[0][8:]);self.assertEqual(command['device_token'],'a'*64);self.assertEqual(command['nonce'],'a'*32)
    def test_other_board_cannot_clone_file(self):
        saved=json.loads(self.identity.read_text());saved['board_uid']='665544332211';self.identity.write_text(json.dumps(saved))
        with self.assertRaises(ValueError):self.run_tool()
        self.assertEqual(self.calls,0);self.assertEqual(self.link.sent,[])
    def test_bad_signature_never_reaches_board(self):
        self.response={**self.response,'signature':'0'*64}
        with self.assertRaises(ValueError):self.run_tool()
        self.assertEqual(self.link.sent,[])

if __name__=='__main__':unittest.main()
