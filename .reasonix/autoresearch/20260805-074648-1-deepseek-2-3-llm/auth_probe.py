# -*- coding: utf-8 -*-
"""检查 auth.json 的 provider/key 配置,只显示 key 尾号"""
import json, sys

p = r'C:\Users\10342\.pi\agent\auth.json'
data = json.load(open(p, encoding='utf-8'))

def mask(v):
    v = str(v)
    if not v or v in ('null', 'None'):
        return '(空)'
    if len(v) <= 10:
        return '***' + v[-4:]
    return v[:6] + '***' + v[-4:]

def walk(d, prefix=''):
    if isinstance(d, dict):
        for k, v in d.items():
            kl = k.lower()
            if isinstance(v, dict):
                walk(v, prefix + k + '.')
            elif 'key' in kl or 'token' in kl or 'secret' in kl:
                print(f'{prefix}{k} = {mask(v)}')
            elif kl in ('baseurl', 'provider', 'type', 'host'):
                print(f'{prefix}{k} = {v}')
    elif isinstance(d, list):
        for i, v in enumerate(d):
            walk(v, prefix + f'[{i}].')

walk(data)
print('--- 顶层 keys:', list(data.keys()) if isinstance(data, dict) else type(data))
